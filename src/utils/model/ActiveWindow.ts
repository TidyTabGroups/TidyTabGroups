import {
  TidyTabs,
  LocalStorage,
  ChromeTabGroupId,
  ChromeTabGroupWithId,
  ChromeTabWithId,
  ChromeWindowId,
  ChromeWindowWithId,
} from "../../types";
import * as Utils from "../../utils";
import * as Storage from "../../utils/storage";
import { v4 as uuidv4 } from "uuid";
import { ActiveWindowSpace } from "./ActiveWindowSpace";
import { ActiveWindowTab } from "./ActiveWindowTab";
import { SpaceAutoCollapseTimer } from "./SpaceAutoCollapseTimer";

export namespace ActiveWindow {
  export function create(createProperties: TidyTabs.ActiveWindowCreateProperties) {
    // TODO: validate createProperties
    const id = createProperties.id || uuidv4();
    return {
      ...createProperties,
      id,
    } as TidyTabs.ActiveWindow;
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
      activeWindows: LocalStorage["activeWindows"];
    }>("activeWindows");
    return result.activeWindows;
  }

  export async function set(activeWindow: TidyTabs.ActiveWindow) {
    const prevActiveWindows = await getAll();
    await setAll([...prevActiveWindows, activeWindow]);
  }

  export async function setAll(activeWindows: LocalStorage["activeWindows"]) {
    await Storage.setItems({ activeWindows });
  }

  export async function update(id: string, updateProperties: Partial<TidyTabs.ActiveWindow>) {
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
      miscTabGroupId: ChromeTabGroupId | undefined;
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

    // if provided, get the provided primary and misc tab group.
    const didProvidePrimarySpaceInfo = !!providedPrimarySpaceInfo;
    const [didProvidePrimaryTabGroup, didProvideMiscTabGroup] = didProvidePrimarySpaceInfo
      ? [
          providedPrimarySpaceInfo!.primaryTabGroupId !== chrome.tabGroups.TAB_GROUP_ID_NONE,
          providedPrimarySpaceInfo!.miscTabGroupId !== chrome.tabGroups.TAB_GROUP_ID_NONE,
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
    const providedMiscTabGroup = didProvideMiscTabGroup
      ? tabGroups.find((tabGroup) => tabGroup.id === providedPrimarySpaceInfo!.miscTabGroupId)
      : undefined;
    if (didProvideMiscTabGroup && !providedMiscTabGroup) {
      throw new Error(
        `activateWindow::misc tab group with id ${
          providedPrimarySpaceInfo!.miscTabGroupId
        } not found`
      );
    }

    let newActiveWindow: TidyTabs.ActiveWindow;
    let newActiveWindowSpaces: TidyTabs.ActiveWindow["spaces"] = [];
    let newActiveWindowSelectedSpaceId: TidyTabs.ActiveWindow["selectedSpaceId"];
    let newActiveWindowPrimarySpaceId: TidyTabs.ActiveWindow["primarySpaceId"];
    let newActiveWindowSelectedTabFocusType: TidyTabs.ActiveWindow["selectedSpaceFocusType"] =
      "nonSpaceTabFocus";
    let newActiveWindowSelectedTabId: TidyTabs.ActiveWindow["selectedTabId"];
    let newActiveWindowMiscTabGroup: TidyTabs.ActiveWindow["miscTabGroup"];
    let newActiveWindowNonGroupedTabs: TidyTabs.ActiveWindow["nonGroupedTabs"];

    let selectedTabGroup: ChromeTabGroupWithId | undefined;
    let tabGroupsToCollapse: ChromeTabGroupId[] = [];
    let primaryTabGroupInfo:
      | { tabGroup: ChromeTabGroupWithId; tabsInGroup: ChromeTabWithId[] }
      | undefined;

    const tabsInprovidedMiscTabGroup = didProvideMiscTabGroup
      ? tabs.filter((tab) => tab.groupId === providedMiscTabGroup!.id)
      : undefined;

    tabGroups.forEach((tabGroup) => {
      const isTabGroupForSelectedTab = tabGroup.id === tabGroupIdForSelectedTab;
      const isTabGroupForPrimarySpace = didProvidePrimarySpaceInfo
        ? providedPrimaryTabGroup!.id === tabGroup.id
        : isTabGroupForSelectedTab;
      const isTabGroupMisc = didProvidePrimarySpaceInfo && tabGroup.id === providedMiscTabGroup!.id;
      const tabsInGroup = tabs.filter((tab) => tab.groupId === tabGroup.id);
      const tabsInSpace =
        isTabGroupForPrimarySpace && providedMiscTabGroup
          ? [...tabsInprovidedMiscTabGroup!, ...tabsInGroup]
          : tabsInGroup;
      const newActiveWindowSpace = ActiveWindowSpace.createFromExistingTabGroup(
        tabGroup,
        tabsInSpace
      );
      newActiveWindowSpaces.push(newActiveWindowSpace);

      if (isTabGroupForSelectedTab) {
        selectedTabGroup = tabGroup;
        newActiveWindowSelectedSpaceId = newActiveWindowSpace.id;
        if (isTabGroupForPrimarySpace) {
          newActiveWindowSelectedTabFocusType = "primaryFocus";
        } else if (isTabGroupMisc) {
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

      if (isTabGroupForPrimarySpace) {
        newActiveWindowPrimarySpaceId = newActiveWindowSpace.id;
        primaryTabGroupInfo = { tabGroup, tabsInGroup };
      }

      if (!isTabGroupForSelectedTab && !isTabGroupForPrimarySpace) {
        tabGroupsToCollapse.push(tabGroup.id);
      }
    });

    const nonGroupedTabs = tabs.filter((tab) => tab.groupId === chrome.tabGroups.TAB_GROUP_ID_NONE);
    newActiveWindowNonGroupedTabs = nonGroupedTabs.map(ActiveWindowTab.createFromExistingTab);
    newActiveWindow = ActiveWindow.create({
      windowId: window.id,
      spaces: newActiveWindowSpaces,
      selectedSpaceId: newActiveWindowSelectedSpaceId,
      primarySpaceId: newActiveWindowPrimarySpaceId,
      selectedSpaceFocusType: newActiveWindowSelectedTabFocusType,
      selectedTabId: newActiveWindowSelectedTabId,
      miscTabGroup: newActiveWindowMiscTabGroup,
      nonGroupedTabs: newActiveWindowNonGroupedTabs,
    });

    // shape up the new active window, using the following steps:
    // 1. create new misc tab group, or move any extra primary tabs to it
    // 2. if exists, move the misc tab group to end position
    // 3. if exists, move the primary tab group to the end position
    // 4. collapse all tab groups that are not the selected or primary space tab group
    // 5. uncollapse selected tab group and primary tab group
    // 6. move all non grouped tabs to before all the tab groups

    // step 1
    let miscTabGroup: ChromeTabGroupWithId | undefined;
    if (primaryTabGroupInfo && primaryTabGroupInfo.tabsInGroup.length > 1) {
      const { tabGroup: primaryTabGroup, tabsInGroup: tabsInPrimaryTabGroup } =
        primaryTabGroupInfo!;
      const isPrimaryTabGroupSelected =
        selectedTabGroup && selectedTabGroup.id === primaryTabGroup.id;
      const tabsInPrimaryTabGroupToMove = isPrimaryTabGroupSelected
        ? tabsInPrimaryTabGroup.filter((tab) => !tab.active)
        : tabsInPrimaryTabGroup.slice(0, tabsInPrimaryTabGroup.length - 1);

      if (didProvideMiscTabGroup) {
        miscTabGroup = providedMiscTabGroup!;
        await chrome.tabs.group({
          tabIds: [...tabsInprovidedMiscTabGroup!, ...tabsInPrimaryTabGroupToMove].map(
            (tab) => tab.id
          ),
        });
      } else {
        const miscTabGroupId = await chrome.tabs.group({
          tabIds: tabsInPrimaryTabGroupToMove.map((tab) => tab.id),
        });
        miscTabGroup = await chrome.tabGroups.get(miscTabGroupId);
        tabGroupsToCollapse.push(miscTabGroupId);
      }
    }

    // step 2
    if (miscTabGroup) {
      await chrome.tabGroups.move(miscTabGroup.id, { index: -1 });
    }

    // step 3
    if (primaryTabGroupInfo) {
      await chrome.tabGroups.move(primaryTabGroupInfo.tabGroup.id, { index: -1 });
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
    if (nonGroupedTabs.length > 0) {
      await chrome.tabs.move(
        nonGroupedTabs.map((tab) => tab.id),
        { index: 0 }
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
      const matchedWindowsToPrevActiveWindows =
        await Utils.WindowMatcher.matchWindowsToActiveWindows(windows, prevActiveWindows);

      const newActiveWindows = await Promise.all(
        matchedWindowsToPrevActiveWindows.map(async (matchedWindowToPrevActiveWindowInfo) => {
          const {
            windowId,
            activeWindow: prevActiveWindow,
            matchedMiscTabGroupInfo,
            matchedNonMiscTabGroups,
          } = matchedWindowToPrevActiveWindowInfo;

          const matchedPrimaryTabGroupInfo = prevActiveWindow.primarySpaceId
            ? matchedNonMiscTabGroups.find(
                (matchedTabGroupInfo) =>
                  matchedTabGroupInfo.spaceId === prevActiveWindow.primarySpaceId
              )
            : undefined;

          const primaryTabGroupId = matchedPrimaryTabGroupInfo?.tabGroupId;

          return ActiveWindow.activateWindow(
            windowId,
            primaryTabGroupId
              ? {
                  primaryTabGroupId,
                  miscTabGroupId: matchedMiscTabGroupInfo?.tabGroupId,
                }
              : undefined
          );
        })
      );

      await Utils.DataModel.ActiveWindow.setAll(newActiveWindows);
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
      const newActiveWindows: TidyTabs.ActiveWindow[] = [];

      await Promise.all(
        activeWindows.map(async (activeWindow) => {
          const window = windows.find((window) => window.id === activeWindow.windowId);
          if (!window) {
            return;
          }
          const tabGroups = await chrome.tabGroups.query({ windowId: window.id });
          const primarySpace = Utils.DataModel.ActiveWindow.getPrimarySpace(activeWindow);
          const primaryTabGroup = primarySpace
            ? tabGroups.find((tabGroup) => tabGroup.id === primarySpace.tabGroupInfo.id)
            : undefined;
          const miscTabGroup =
            primaryTabGroup && activeWindow.miscTabGroup
              ? tabGroups.find((tabGroup) => tabGroup.id === activeWindow.miscTabGroup!.id)
              : undefined;
          const newActiveWindow = await ActiveWindow.activateWindow(
            window.id,
            primaryTabGroup
              ? { primaryTabGroupId: primaryTabGroup.id, miscTabGroupId: miscTabGroup?.id }
              : undefined
          );
          newActiveWindows.push(newActiveWindow);
        })
      );

      await Utils.DataModel.ActiveWindow.setAll(newActiveWindows);
    } catch (error) {
      const errorMessage = new Error(
        `DataModel::initialize:Could not intitialize data model: ${error}`
      );
      console.error(errorMessage);
      throw error;
    }
  }

  export function getPrimarySpace(activeWindow: TidyTabs.ActiveWindow) {
    if (!activeWindow.primarySpaceId) {
      return;
    }
    return activeWindow.spaces.find((space) => space.id === activeWindow.primarySpaceId!);
  }
}
