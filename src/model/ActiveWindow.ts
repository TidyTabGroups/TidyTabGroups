import {
  ChromeTabGroupId,
  ChromeTabGroupWithId,
  ChromeTabWithId,
  ChromeWindowId,
  ChromeWindowWithId,
  DataModel,
} from "../types";
import * as WindowMatcher from "../windowMatcher";
import * as Storage from "../storage";
import { v4 as uuidv4 } from "uuid";
import { ActiveWindowSpace } from "./ActiveWindowSpace";
import { ActiveWindowTab } from "./ActiveWindowTab";
import { SpaceAutoCollapseTimer } from "./SpaceAutoCollapseTimer";

export namespace ActiveWindow {
  export function create(createProperties: DataModel.ActiveWindowCreateProperties) {
    // TODO: validate createProperties
    const id = createProperties.id || uuidv4();
    return {
      ...createProperties,
      id,
    } as DataModel.ActiveWindow;
  }

  export async function createAndSet(createProperties: DataModel.ActiveWindowCreateProperties) {
    const newActiveWindow = create(createProperties);
    await set(newActiveWindow);
    return newActiveWindow;
  }

  export async function get(activeWindowId: string) {
    const activeWindows = await getAll();
    const activeWindow = activeWindows.find((window) => window.id === activeWindowId);
    if (!activeWindow) {
      const errorMessage = `ActiveWindow::get: No active window found with id: ${activeWindowId}`;
      console.error(errorMessage);
      throw new Error(errorMessage);
    }
    return activeWindow;
  }

  export async function getAll() {
    const result = await Storage.getGuaranteedItems<{
      activeWindows: DataModel.Model["activeWindows"];
    }>("activeWindows");
    return result.activeWindows;
  }

  export async function getByChromeWindowId(windowId: ChromeWindowId) {
    const activeWindows = await getAll();
    return activeWindows.find((window) => window.windowId === windowId);
  }

  export async function set(activeWindow: DataModel.ActiveWindow) {
    const prevActiveWindows = await getAll();
    await setAll([...prevActiveWindows, activeWindow]);
  }

  export async function setAll(activeWindows: DataModel.Model["activeWindows"]) {
    await Storage.setItems({ activeWindows });
  }

  export async function update(id: string, updateProperties: Partial<DataModel.ActiveWindow>) {
    const activeWindows = await getAll();
    const prevActiveWindow = activeWindows.find((window) => window.id === id);

    if (!prevActiveWindow) {
      const errorMessage = `ActiveWindow::update: No active window found with id: ${id}`;
      console.error(errorMessage);
      throw new Error(errorMessage);
    }

    const updatedWindow = { ...prevActiveWindow, ...updateProperties };

    const updatedActiveWindows = activeWindows.map((window) =>
      window.id === id ? updatedWindow : window
    );

    return await setAll(updatedActiveWindows);
  }

  export async function activateWindow(
    windowId: ChromeWindowId,
    providedPrimarySpaceInfo?: {
      primaryTabGroupId: ChromeTabGroupId;
      secondaryTabGroupId: ChromeTabGroupId | undefined;
    }
  ) {
    const window = (await chrome.windows.get(windowId)) as ChromeWindowWithId;
    if (!window) {
      throw new Error(`activateWindow::window with id ${window} not found`);
    }

    if (window.type !== "normal") {
      throw new Error(`activateWindow::window with id ${window} is not a normal window`);
    }

    const tabGroups = await chrome.tabGroups.query({ windowId });
    const tabs = (await chrome.tabs.query({ windowId })) as ChromeTabWithId[];
    const selectedTab = tabs.find((tab) => tab.active)!;
    const tabGroupIdForSelectedTab = selectedTab.groupId;

    // if provided, get the provided primary and secondary tab group.
    const didProvidePrimarySpaceInfo = !!providedPrimarySpaceInfo;
    const [didProvidePrimaryTabGroup, didProvideSecondaryTabGroup] = didProvidePrimarySpaceInfo
      ? [
          providedPrimarySpaceInfo!.primaryTabGroupId !== chrome.tabGroups.TAB_GROUP_ID_NONE,
          providedPrimarySpaceInfo!.secondaryTabGroupId !== chrome.tabGroups.TAB_GROUP_ID_NONE,
        ]
      : [false, false];
    const providedPrimaryTabGroup = didProvidePrimaryTabGroup
      ? tabGroups.find((tabGroup) => tabGroup.id === providedPrimarySpaceInfo!.primaryTabGroupId)
      : undefined;
    if (didProvidePrimaryTabGroup && !providedPrimaryTabGroup) {
      throw new Error(
        `activateWindow::primary tab group with id ${
          providedPrimarySpaceInfo!.primaryTabGroupId
        } not found`
      );
    }
    const providedSecondaryTabGroup = didProvideSecondaryTabGroup
      ? tabGroups.find((tabGroup) => tabGroup.id === providedPrimarySpaceInfo!.secondaryTabGroupId)
      : undefined;
    if (didProvideSecondaryTabGroup && !providedSecondaryTabGroup) {
      throw new Error(
        `activateWindow::secondary tab group with id ${
          providedPrimarySpaceInfo!.secondaryTabGroupId
        } not found`
      );
    }

    let newActiveWindow: DataModel.ActiveWindow;
    let newActiveWindowSpaces: DataModel.ActiveWindow["spaces"] = [];
    let newActiveWindowSelectedSpaceId: DataModel.ActiveWindow["selectedSpaceId"] = null;
    let newActiveWindowPrimarySpaceId: DataModel.ActiveWindow["primarySpaceId"] = null;
    let newActiveWindowSelectedTabFocusType: DataModel.ActiveWindow["selectedSpaceFocusType"] =
      "nonSpaceTabFocus";
    let newActiveWindowSelectedTabId: DataModel.ActiveWindow["selectedTabId"] | undefined;
    let newActiveWindowSecondaryTabGroup: DataModel.ActiveWindow["secondaryTabGroup"] = null;
    let newActiveWindowNonGroupedTabs: DataModel.ActiveWindow["nonGroupedTabs"] = [];

    let selectedTabGroup: ChromeTabGroupWithId | undefined;
    let tabGroupsToCollapse: ChromeTabGroupId[] = [];
    let primaryTabGroupInfo:
      | { tabGroup: ChromeTabGroupWithId; tabsInGroup: ChromeTabWithId[] }
      | undefined;

    const tabsInprovidedSecondaryTabGroup = didProvideSecondaryTabGroup
      ? tabs.filter((tab) => tab.groupId === providedSecondaryTabGroup!.id)
      : undefined;

    tabGroups.forEach((tabGroup) => {
      const isTabGroupForSelectedTab = tabGroup.id === tabGroupIdForSelectedTab;
      const isTabGroupPrimary = didProvidePrimarySpaceInfo
        ? providedPrimaryTabGroup!.id === tabGroup.id
        : isTabGroupForSelectedTab;
      const isTabGroupSecondary =
        didProvidePrimarySpaceInfo && tabGroup.id === providedSecondaryTabGroup!.id;
      const tabsInGroup = tabs.filter((tab) => tab.groupId === tabGroup.id);
      const tabsInSpace =
        isTabGroupPrimary && providedSecondaryTabGroup
          ? [...tabsInprovidedSecondaryTabGroup!, ...tabsInGroup]
          : tabsInGroup;
      const newActiveWindowSpace = ActiveWindowSpace.createFromExistingTabGroup(
        tabGroup,
        tabsInSpace
      );
      newActiveWindowSpaces.push(newActiveWindowSpace);

      if (isTabGroupForSelectedTab) {
        selectedTabGroup = tabGroup;
        newActiveWindowSelectedSpaceId = newActiveWindowSpace.id;
        if (isTabGroupPrimary) {
          newActiveWindowSelectedTabFocusType = "primaryFocus";
        } else if (isTabGroupSecondary) {
          newActiveWindowSelectedTabFocusType = "secondaryFocus";
        } else {
          newActiveWindowSelectedTabFocusType = "peakFocus";
        }

        newActiveWindowSelectedSpaceId = newActiveWindowSpace.id;
        const selectedActiveWindowTab = newActiveWindowSpace.tabs.find(
          (tab) => tab.tabInfo.id === selectedTab.id
        )!.id;

        if (!selectedActiveWindowTab) {
          const errorMessage = `initializeDataModel::Error: No active tab found with id: ${selectedTab.id}`;
          console.error(errorMessage);
          throw new Error(errorMessage);
        }

        newActiveWindowSelectedTabId = selectedActiveWindowTab;
      }

      if (isTabGroupPrimary) {
        newActiveWindowPrimarySpaceId = newActiveWindowSpace.id;
        primaryTabGroupInfo = { tabGroup, tabsInGroup };
      }

      if (!isTabGroupForSelectedTab && !isTabGroupPrimary) {
        tabGroupsToCollapse.push(tabGroup.id);
      }
    });

    tabs.forEach((tab) => {
      if (tab.groupId === chrome.tabGroups.TAB_GROUP_ID_NONE) {
        const newActiveWindowTab = ActiveWindowTab.createFromExistingTab(tab);
        newActiveWindowNonGroupedTabs.push(newActiveWindowTab);
        if (selectedTab.id === tab.id) {
          newActiveWindowSelectedTabId = newActiveWindowTab.id;
        }
      }
    });

    if (!newActiveWindowSelectedTabId) {
      throw new Error(`initializeDataModel::Error: No selected tab found`);
    }

    newActiveWindow = await ActiveWindow.createAndSet({
      windowId: window.id,
      spaces: newActiveWindowSpaces,
      selectedSpaceId: newActiveWindowSelectedSpaceId,
      primarySpaceId: newActiveWindowPrimarySpaceId,
      selectedSpaceFocusType: newActiveWindowSelectedTabFocusType,
      selectedTabId: newActiveWindowSelectedTabId,
      secondaryTabGroup: newActiveWindowSecondaryTabGroup,
      nonGroupedTabs: newActiveWindowNonGroupedTabs,
    });

    // shape up the new active window, using the following steps:
    // 1. create new secondary tab group, or move any extra primary tabs to it
    // 2. if exists, move the secondary tab group to end position
    // 3. if exists, move the primary tab group to the end position
    // 4. collapse all tab groups that are not the selected or primary space tab group
    // 5. uncollapse selected tab group and primary tab group
    // 6. move all non grouped tabs to before all the tab groups

    // step 1
    let secondaryTabGroup: ChromeTabGroupWithId | undefined;
    if (primaryTabGroupInfo && primaryTabGroupInfo.tabsInGroup.length > 1) {
      const { tabGroup: primaryTabGroup, tabsInGroup: tabsInPrimaryTabGroup } =
        primaryTabGroupInfo!;
      const isPrimaryTabGroupSelected =
        selectedTabGroup && selectedTabGroup.id === primaryTabGroup.id;
      const tabsInPrimaryTabGroupToMove = isPrimaryTabGroupSelected
        ? tabsInPrimaryTabGroup.filter((tab) => !tab.active)
        : tabsInPrimaryTabGroup.slice(0, tabsInPrimaryTabGroup.length - 1);

      if (didProvideSecondaryTabGroup) {
        secondaryTabGroup = providedSecondaryTabGroup!;
        await chrome.tabs.group({
          tabIds: [...tabsInprovidedSecondaryTabGroup!, ...tabsInPrimaryTabGroupToMove].map(
            (tab) => tab.id
          ),
        });
      } else {
        const secondaryTabGroupId = await chrome.tabs.group({
          tabIds: tabsInPrimaryTabGroupToMove.map((tab) => tab.id),
        });
        secondaryTabGroup = await chrome.tabGroups.get(secondaryTabGroupId);
        tabGroupsToCollapse.push(secondaryTabGroupId);
      }
    }

    // step 2
    if (secondaryTabGroup) {
      await ActiveWindow.update(newActiveWindow.id, { secondaryTabGroup });
      await chrome.tabGroups.move(secondaryTabGroup.id, {
        windowId,
        index: -1,
      });
    }

    // step 3
    if (primaryTabGroupInfo) {
      await chrome.tabGroups.move(primaryTabGroupInfo.tabGroup.id, {
        windowId,
        index: -1,
      });
    }

    // step 4
    await Promise.all(
      tabGroupsToCollapse.map((tabGroupId) =>
        chrome.tabGroups.update(tabGroupId, { collapsed: true })
      )
    );

    // step 5
    if (selectedTabGroup) {
      await chrome.tabGroups.update(selectedTabGroup.id, { collapsed: false });
    }
    if (primaryTabGroupInfo) {
      await chrome.tabGroups.update(primaryTabGroupInfo.tabGroup.id, { collapsed: false });
    }

    // step 6
    const nonGroupedTabs = tabs.filter((tab) => tab.groupId === chrome.tabGroups.TAB_GROUP_ID_NONE);
    if (nonGroupedTabs.length > 0) {
      await chrome.tabs.move(
        nonGroupedTabs.map((tab) => tab.id),
        { windowId, index: 0 }
      );
    }

    // group any non-grouped tabs in the window
    // let nonGroupedTabsNewGroup: ChromeTabGroupWithId | undefined;
    // const nonGroupedTabs = windowInfo.tabs.filter(
    //   (tab) => tab.groupId === chrome.tabGroups.TAB_GROUP_ID_NONE
    // );
    // if (nonGroupedTabs.length > 0) {
    //   const tabGroupId = await chrome.tabs.group({
    //     createProperties: {
    //       windowId: windowInfo.window.id,
    //     },
    //     tabIds: nonGroupedTabs.map((tab) => tab.id),
    //   });
    //   nonGroupedTabsNewGroup = await chrome.tabGroups.get(tabGroupId);
    // }

    if (
      newActiveWindowSelectedSpaceId &&
      // @ts-ignore
      (newActiveWindowSelectedTabFocusType === "peakFocus" ||
        // @ts-ignore
        newActiveWindowSelectedTabFocusType === "secondaryFocus")
    ) {
      await SpaceAutoCollapseTimer.startAutoCollapseTimerForSpace(
        newActiveWindow.id,
        newActiveWindowSelectedSpaceId
      );
    }

    return newActiveWindow;
  }

  export async function reactivateWindowsForStartup() {
    try {
      const prevActiveWindows = await ActiveWindow.getAll();
      const windows = (await chrome.windows.getAll()) as ChromeWindowWithId[];
      const matchedWindowsToPrevActiveWindows = await WindowMatcher.matchWindowsToActiveWindows(
        windows,
        prevActiveWindows
      );

      matchedWindowsToPrevActiveWindows.forEach(async (matchedWindowToPrevActiveWindowInfo) => {
        const {
          windowId,
          activeWindow: prevActiveWindow,
          matchedSecondaryTabGroupInfo,
          matchedNonSecondaryTabGroups,
        } = matchedWindowToPrevActiveWindowInfo;

        const matchedPrimaryTabGroupInfo = prevActiveWindow.primarySpaceId
          ? matchedNonSecondaryTabGroups.find(
              (matchedTabGroupInfo) =>
                matchedTabGroupInfo.spaceId === prevActiveWindow.primarySpaceId
            )
          : undefined;

        const primaryTabGroupId = matchedPrimaryTabGroupInfo?.tabGroupId;

        await ActiveWindow.activateWindow(
          windowId,
          primaryTabGroupId
            ? {
                primaryTabGroupId,
                secondaryTabGroupId: matchedSecondaryTabGroupInfo?.tabGroupId,
              }
            : undefined
        );
      });
    } catch (error) {
      const errorMessage = new Error(
        `DataModel::initialize:Could not intitialize data model: ${error}`
      );
      console.error(errorMessage);
      throw error;
    }
  }

  export async function reactivateWindowsForUpdate() {
    try {
      const activeWindows = await ActiveWindow.getAll();
      const windows = (await chrome.windows.getAll()) as ChromeWindowWithId[];

      activeWindows.forEach(async (activeWindow) => {
        const window = windows.find((window) => window.id === activeWindow.windowId);
        if (!window) {
          return;
        }
        const tabGroups = await chrome.tabGroups.query({ windowId: window.id });
        const primarySpace = ActiveWindow.getPrimarySpace(activeWindow);
        const primaryTabGroup = primarySpace
          ? tabGroups.find((tabGroup) => tabGroup.id === primarySpace.tabGroupInfo.id)
          : undefined;
        const secondaryTabGroup =
          primaryTabGroup && activeWindow.secondaryTabGroup
            ? tabGroups.find((tabGroup) => tabGroup.id === activeWindow.secondaryTabGroup!.id)
            : undefined;
        const newActiveWindow = await ActiveWindow.activateWindow(
          window.id,
          primaryTabGroup
            ? {
                primaryTabGroupId: primaryTabGroup.id,
                secondaryTabGroupId: secondaryTabGroup?.id,
              }
            : undefined
        );
      });
    } catch (error) {
      const errorMessage = new Error(
        `DataModel::initialize:Could not intitialize data model: ${error}`
      );
      console.error(errorMessage);
      throw error;
    }
  }

  export function getPrimarySpace(activeWindow: DataModel.ActiveWindow) {
    if (!activeWindow.primarySpaceId) {
      return;
    }
    return activeWindow.spaces.find((space) => space.id === activeWindow.primarySpaceId!);
  }
}
