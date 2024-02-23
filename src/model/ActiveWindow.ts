import { ChromeTabGroupId, ChromeTabGroupWithId, ChromeTabId, ChromeTabWithId, ChromeWindowId, ChromeWindowWithId, DataModel } from "../types";
import * as WindowMatcher from "../windowMatcher";
import * as Storage from "../storage";
import { v4 as uuidv4 } from "uuid";
import { ActiveWindowSpace } from "./ActiveWindowSpace";
import { ActiveWindowTab } from "./ActiveWindowTab";
import { SpaceAutoCollapseTimer } from "./SpaceAutoCollapseTimer";
import Database from "../database";
import { IndexKey, IndexNames, StoreNames } from "idb";

export namespace ActiveWindow {
  export function create(createProperties: DataModel.ActiveWindowCreateProperties) {
    // TODO: validate createProperties
    const id = createProperties.id || uuidv4();
    return {
      ...createProperties,
      id,
    } as DataModel.ActiveWindow;
  }

  export async function createAndAdd(
    createProperties: DataModel.ActiveWindowCreateProperties,
    spaces: DataModel.ActiveSpace[],
    tabs: DataModel.ActiveTab[]
  ) {
    const newActiveWindow = create(createProperties);
    const modelDB = await Database.getDBConnection<DataModel.ModelDB>("model");
    const transaction = modelDB.transaction(["activeWindows", "activeSpaces", "activeTabs"], "readwrite");
    const activeWindowsStore = transaction.objectStore("activeWindows");
    const activeSpacesStore = transaction.objectStore("activeSpaces");
    const activeTabsStore = transaction.objectStore("activeTabs");
    activeWindowsStore.add(newActiveWindow);
    spaces.forEach((space) => activeSpacesStore.add(space));
    tabs.forEach((tab) => activeTabsStore.add(tab));
    await transaction.done;
    return newActiveWindow;
  }

  export async function get(activeWindowId: string) {
    const modelDB = await Database.getDBConnection<DataModel.ModelDB>("model");
    const activeWindow = await modelDB.get("activeWindows", activeWindowId);
    if (!activeWindow) {
      throw new Error(`ActiveWindow::get: No active window found with id: ${activeWindowId}`);
    }
    return activeWindow;
  }

  export async function getFromIndex<IndexName extends IndexNames<DataModel.ModelDB, "activeWindows">>(
    index: IndexName,
    query: IndexKey<DataModel.ModelDB, "activeWindows", IndexName> | IDBKeyRange
  ) {
    const modelDB = await Database.getDBConnection<DataModel.ModelDB>("model");
    return await modelDB.getFromIndex<"activeWindows", IndexName>("activeWindows", index, query);
  }

  export async function getAll() {
    const modelDB = await Database.getDBConnection<DataModel.ModelDB>("model");
    return modelDB.getAll("activeWindows");
  }

  export async function getAllFromIndex<IndexName extends IndexNames<DataModel.ModelDB, "activeWindows">>(index: IndexName) {
    const modelDB = await Database.getDBConnection<DataModel.ModelDB>("model");
    return modelDB.getAllFromIndex<"activeWindows", IndexName>("activeWindows", index);
  }

  export async function add(activeWindow: DataModel.ActiveWindow) {
    const modelDB = await Database.getDBConnection<DataModel.ModelDB>("model");
    await modelDB.add("activeWindows", activeWindow);
  }

  export async function remove(id: string) {
    const modelDB = await Database.getDBConnection<DataModel.ModelDB>("model");
    await modelDB.delete("activeWindows", id);
  }

  export async function removeAllCascading(activeWindowIds: string[]) {
    const modelDB = await Database.getDBConnection<DataModel.ModelDB>("model");
    const transaction = modelDB.transaction(["activeWindows", "activeSpaces", "activeTabs", "spaceAutoCollapseTimers"], "readwrite");
    const activeWindowsStore = transaction.objectStore("activeWindows");
    const activeSpacesStore = transaction.objectStore("activeSpaces");
    const activeTabsStore = transaction.objectStore("activeTabs");
    const spaceAutoCollapseTimerStore = transaction.objectStore("spaceAutoCollapseTimers");

    await Promise.all(
      activeWindowIds.map(async (activeWindowId) => {
        await activeWindowsStore.delete(activeWindowId);
        const activeWindowIndexForActiveSpaces = activeSpacesStore.index("activeWindowId");
        const activeSpaceIds = await activeWindowIndexForActiveSpaces.getAllKeys(activeWindowId);
        await Promise.all(activeSpaceIds.map((activeSpaceId) => activeSpacesStore.delete(activeSpaceId)));

        const activeWindowIndexForActiveTabs = activeTabsStore.index("activeWindowId");
        const activeTabIds = await activeWindowIndexForActiveTabs.getAllKeys(activeWindowId);
        await Promise.all(activeTabIds.map((activeTabId) => activeTabsStore.delete(activeTabId)));

        const activeWindowIndexForSpaceAutoCollapseTimers = spaceAutoCollapseTimerStore.index("activeWindowId");
        const spaceAutoCollapseTimerIds = await activeWindowIndexForSpaceAutoCollapseTimers.getAllKeys(activeWindowId);
        await Promise.all(spaceAutoCollapseTimerIds.map((spaceAutoCollapseTimerId) => spaceAutoCollapseTimerStore.delete(spaceAutoCollapseTimerId)));
      })
    );
    await transaction.done;
  }

  export async function update(id: string, updateProperties: Partial<DataModel.ActiveWindow>) {
    const modelDB = await Database.getDBConnection<DataModel.ModelDB>("model");
    const activeWindow = await get(id);
    await modelDB.put("activeWindows", { ...activeWindow, ...updateProperties, id });
  }

  export async function adjustAndExtractActiveWindowInfoForWindow(
    windowId: ChromeWindowId,
    providedPrimarySpaceInfo?: { primaryTabGroupId: ChromeTabGroupId; secondaryTabGroupId: ChromeTabGroupId | undefined }
  ) {
    const window = (await chrome.windows.get(windowId)) as ChromeWindowWithId;
    if (!window) {
      throw new Error(`adjustAndExtractActiveWindowInfoForWindow::window with id ${window} not found`);
    }

    if (window.type !== "normal") {
      throw new Error(`adjustAndExtractActiveWindowInfoForWindow::window with id ${window} is not a normal window`);
    }

    const tabGroups = await chrome.tabGroups.query({ windowId });
    const tabs = (await chrome.tabs.query({ windowId })) as ChromeTabWithId[];
    const selectedTab = tabs.find((tab) => tab.active)!;

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
        `adjustAndExtractActiveWindowInfoForWindow::primary tab group with id ${providedPrimarySpaceInfo!.primaryTabGroupId} not found`
      );
    }
    const providedSecondaryTabGroup = didProvideSecondaryTabGroup
      ? tabGroups.find((tabGroup) => tabGroup.id === providedPrimarySpaceInfo!.secondaryTabGroupId)
      : undefined;
    if (didProvideSecondaryTabGroup && !providedSecondaryTabGroup) {
      throw new Error(
        `adjustAndExtractActiveWindowInfoForWindow::secondary tab group with id ${providedPrimarySpaceInfo!.secondaryTabGroupId} not found`
      );
    }

    let selectedTabGroup: ChromeTabGroupWithId | undefined;
    let primaryTabGroupInfo: { tabGroup: ChromeTabGroupWithId; tabsInGroup: ChromeTabWithId[] } | undefined;

    // adjust the "shape" ofthe new active window, using the following adjustments:
    // 1. If a primary tab group exists and it has more than one tab, create new secondary tab group if not provided,
    //   and/or move any extra primary tabs to it.
    // 2. if exists, move the secondary tab group to end position
    // 3. if exists, move the primary tab group to the end position
    // 4. collapse all tab groups that are not the selected or primary space tab group
    // 5. uncollapse primary tab group
    // 6. move all non grouped tabs to before all the tab groups

    const { tabGroup: primaryTabGroup, tabsInGroup: tabsInPrimaryTabGroup } = primaryTabGroupInfo || {};

    let ultimatePrimaryTabGroup: ChromeTabGroupWithId | undefined = primaryTabGroup;
    let ultimateSecondaryTabGroup: ChromeTabGroupWithId | undefined;
    let ultimateSelectedTab: ChromeTabWithId = selectedTab;

    // adjustment 1
    if (ultimatePrimaryTabGroup && tabsInPrimaryTabGroup!.length > 1) {
      const isPrimaryTabGroupSelected = selectedTabGroup && selectedTabGroup.id === ultimatePrimaryTabGroup.id;
      const tabsInPrimaryTabGroupToMove = isPrimaryTabGroupSelected
        ? tabsInPrimaryTabGroup!.filter((tab) => !tab.active)
        : tabsInPrimaryTabGroup!.slice(0, tabsInPrimaryTabGroup!.length - 1);
      let ultimateSecondaryTabGroupId: ChromeTabGroupId;

      if (didProvideSecondaryTabGroup) {
        const tabsInprovidedSecondaryTabGroup = didProvideSecondaryTabGroup
          ? tabs.filter((tab) => tab.groupId === providedSecondaryTabGroup!.id)
          : undefined;
        ultimateSecondaryTabGroupId = await chrome.tabs.group({
          tabIds: [...tabsInprovidedSecondaryTabGroup!, ...tabsInPrimaryTabGroupToMove].map((tab) => tab.id),
        });

        if (ultimateSelectedTab.groupId === ultimatePrimaryTabGroup.id) {
          ultimateSelectedTab = (await chrome.tabs.get(selectedTab.id)) as ChromeTabWithId;
        }
      } else {
        ultimateSecondaryTabGroupId = await chrome.tabs.group({
          tabIds: tabsInPrimaryTabGroupToMove.map((tab) => tab.id),
        });
      }

      // adjustment 2
      ultimateSecondaryTabGroup = await chrome.tabGroups.move(ultimateSecondaryTabGroupId, {
        windowId,
        index: -1,
      });

      // adjustment 3
      ultimatePrimaryTabGroup = await chrome.tabGroups.move(ultimatePrimaryTabGroup.id, {
        windowId,
        index: -1,
      });
    }

    // adjustment 4
    await Promise.all(
      tabGroups.map(async (tabGroup) => {
        if (tabGroup.id !== selectedTab.groupId && tabGroup.id !== ultimatePrimaryTabGroup?.id) {
          const updatedTabGroup = await chrome.tabGroups.update(tabGroup.id, { collapsed: true });
          if (updatedTabGroup.id === ultimateSecondaryTabGroup?.id) {
            ultimateSecondaryTabGroup = updatedTabGroup;
          }
        }
      })
    );

    // adjustment 5
    if (ultimatePrimaryTabGroup) {
      ultimatePrimaryTabGroup = await chrome.tabGroups.update(ultimatePrimaryTabGroup.id, { collapsed: false });
    }

    // adjustment 6
    const nonGroupedTabIds = tabs.filter((tab) => tab.groupId === chrome.tabGroups.TAB_GROUP_ID_NONE).map((tab) => tab.id);
    if (nonGroupedTabIds.length > 0) {
      await chrome.tabs.move(nonGroupedTabIds, { windowId, index: 0 });
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

    return {
      primaryTabGroupId: ultimatePrimaryTabGroup?.id,
      secondaryTabGroupId: ultimateSecondaryTabGroup?.id,
    };
  }

  export async function activateWindow(
    windowId: ChromeWindowId,
    providedPrimarySpaceInfo?: {
      primaryTabGroupId: ChromeTabGroupId;
      secondaryTabGroupId: ChromeTabGroupId | undefined;
    }
  ) {
    const { primaryTabGroupId, secondaryTabGroupId } = await adjustAndExtractActiveWindowInfoForWindow(windowId, providedPrimarySpaceInfo);
    const tabGroups = await chrome.tabGroups.query({ windowId });
    const tabs = (await chrome.tabs.query({ windowId })) as ChromeTabWithId[];

    const newActiveWindowId = uuidv4();
    let newActiveWindowSpaces: DataModel.ActiveSpace[] = [];
    let newActiveWindowTabs: DataModel.ActiveTab[] = [];
    let newActiveWindowSelectedSpaceId: DataModel.ActiveWindow["selectedSpaceId"] = null;
    let newActiveWindowPrimarySpaceId: DataModel.ActiveWindow["primarySpaceId"] = null;
    let newActiveWindowSelectedTabFocusType: DataModel.ActiveWindow["selectedSpaceFocusType"];
    let newActiveWindowSelectedTabId: DataModel.ActiveWindow["selectedTabId"] | undefined;
    let newActiveWindowSecondaryTabGroup: DataModel.ActiveWindow["secondaryTabGroup"] = null;

    const tabsInSecondaryGroup = secondaryTabGroupId ? tabs.filter((tab) => tab.groupId === secondaryTabGroupId) : [];
    const selectedTab = tabs.find((tab) => tab.active)!;

    if (selectedTab.groupId === chrome.tabGroups.TAB_GROUP_ID_NONE) {
      newActiveWindowSelectedTabFocusType = "nonSpaceTabFocus";
    } else if (selectedTab.groupId === primaryTabGroupId) {
      newActiveWindowSelectedTabFocusType = "primaryFocus";
    } else if (selectedTab.groupId === secondaryTabGroupId) {
      newActiveWindowSelectedTabFocusType = "secondaryFocus";
    } else {
      newActiveWindowSelectedTabFocusType = "peakFocus";
    }

    tabs.forEach((tab) => {
      if (tab.groupId === chrome.tabGroups.TAB_GROUP_ID_NONE) {
        const newActiveWindowTab = ActiveWindowTab.createFromExistingTab(newActiveWindowId, null, tab);
        newActiveWindowTabs.push(newActiveWindowTab);
        if (selectedTab.id === tab.id) {
          newActiveWindowSelectedTabId = newActiveWindowTab.id;
        }
      }
    });

    tabGroups.forEach((tabGroup) => {
      const isPrimaryTabGroup = primaryTabGroupId && tabGroup.id === primaryTabGroupId;
      const isSecondaryTabGroup = tabGroup.id === secondaryTabGroupId;

      if (isSecondaryTabGroup) {
        newActiveWindowSecondaryTabGroup = tabGroup;
        return;
      }

      const newActiveWindowSpaceId = uuidv4();
      const newActiveWindowSpace = ActiveWindowSpace.create({
        id: newActiveWindowSpaceId,
        activeWindowId: newActiveWindowId,
        tabGroupInfo: {
          id: tabGroup.id,
          title: tabGroup.title,
          color: tabGroup.color,
          collapsed: tabGroup.collapsed,
        },
      });
      newActiveWindowSpaces.push(newActiveWindowSpace);

      if (isPrimaryTabGroup) {
        newActiveWindowPrimarySpaceId = newActiveWindowSpace.id;
      }

      const tabsInGroup = tabs.filter((tab) => tab.groupId === tabGroup.id);
      const tabsForSpace = isPrimaryTabGroup ? [...tabsInGroup, ...tabsInSecondaryGroup] : tabsInGroup;
      tabsForSpace.forEach((tab) => {
        const newActiveWindowTab = ActiveWindowTab.createFromExistingTab(newActiveWindowId, newActiveWindowSpaceId, tab);
        newActiveWindowTabs.push(newActiveWindowTab);

        if (selectedTab.id === tab.id) {
          newActiveWindowSelectedTabId = newActiveWindowTab.id;
        }
      });
    });

    // FIXME: get rid of this type assertion when we have figured out a better way to handle it
    if (!newActiveWindowSelectedTabId) {
      throw new Error(`activateWindow::Error: No selected tab found`);
    }

    const newActiveWindow = await ActiveWindow.createAndAdd(
      {
        id: newActiveWindowId,
        windowId,
        selectedSpaceId: newActiveWindowSelectedSpaceId,
        primarySpaceId: newActiveWindowPrimarySpaceId,
        selectedSpaceFocusType: newActiveWindowSelectedTabFocusType,
        selectedTabId: newActiveWindowSelectedTabId,
        secondaryTabGroup: newActiveWindowSecondaryTabGroup,
      },
      newActiveWindowSpaces,
      newActiveWindowTabs
    );

    if (newActiveWindowSelectedTabFocusType === "peakFocus" || newActiveWindowSelectedTabFocusType === "secondaryFocus") {
      // FIXME: get rid of this type assertion when we have figured out a better way to handle it
      if (!newActiveWindowSelectedSpaceId) {
        throw new Error(`activateWindow::Error: No selected space found`);
      }
      await SpaceAutoCollapseTimer.startAutoCollapseTimerForSpace(newActiveWindow.id, newActiveWindowSelectedSpaceId);
    }

    return newActiveWindow;
  }

  export async function reactivateWindowsForStartup() {
    try {
      const prevActiveWindows = await ActiveWindow.getAll();
      const windows = (await chrome.windows.getAll()) as ChromeWindowWithId[];
      const matchedWindowsToPrevActiveWindows = await WindowMatcher.matchWindowsToActiveWindows(windows, prevActiveWindows);

      await Promise.all(
        matchedWindowsToPrevActiveWindows.map(async (matchedWindowToPrevActiveWindowInfo) => {
          const {
            windowId,
            activeWindow: prevActiveWindow,
            matchedSecondaryTabGroupInfo,
            matchedNonSecondaryTabGroups,
          } = matchedWindowToPrevActiveWindowInfo;

          const matchedPrimaryTabGroupInfo = prevActiveWindow.primarySpaceId
            ? matchedNonSecondaryTabGroups.find((matchedTabGroupInfo) => matchedTabGroupInfo.activeSpaceId === prevActiveWindow.primarySpaceId)
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
        })
      );
      // remove the previous active windows
      await removeAllCascading(prevActiveWindows.map((prevActiveWindow) => prevActiveWindow.id));
    } catch (error) {
      const errorMessage = new Error(`DataModel::initialize:Could not intitialize data model: ${error}`);
      console.error(errorMessage);
      throw error;
    }
  }

  export async function reactivateWindowsForUpdate() {
    try {
      const activeWindows = await ActiveWindow.getAll();
      const windows = (await chrome.windows.getAll()) as ChromeWindowWithId[];

      await Promise.all(
        activeWindows.map(async (activeWindow) => {
          const window = windows.find((window) => window.id === activeWindow.windowId);
          if (!window) {
            return;
          }
          const tabGroups = await chrome.tabGroups.query({ windowId: window.id });
          const primarySpace = await ActiveWindow.getPrimarySpace(activeWindow.id);
          const primaryTabGroup = primarySpace ? tabGroups.find((tabGroup) => tabGroup.id === primarySpace.tabGroupInfo.id) : undefined;
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
        })
      );

      // remove the previous active windows
      await removeAllCascading(activeWindows.map((activeWindow) => activeWindow.id));
    } catch (error) {
      const errorMessage = new Error(`DataModel::initialize:Could not intitialize data model: ${error}`);
      console.error(errorMessage);
      throw error;
    }
  }

  export async function getPrimarySpace(id: string) {
    return await ActiveWindowSpace.getFromIndex("activeWindowId", id);
  }

  export async function getActiveSpacesAndTabs(ids: string[]) {
    const activeSpacesByActiveWindowId: { [activeWindowId: string]: DataModel.ActiveSpace[] } = {};
    const activeNonGroupedActiveTabsByWindowId: { [activeWindowId: string]: DataModel.ActiveTab[] } = {};
    const activeTabsByActiveSpaceId: { [activeSpaceId: string]: DataModel.ActiveTab[] } = {};

    const modelDB = await Database.getDBConnection<DataModel.ModelDB>("model");
    const transaction = modelDB.transaction(["activeSpaces", "activeTabs"], "readonly");

    const activeSpacesStore = transaction.objectStore("activeSpaces");
    const activeTabsStore = transaction.objectStore("activeTabs");

    const activeWindowIdIndexForActiveSpaces = activeSpacesStore.index("activeWindowId");
    const activeWindowIdIndexForActiveTabs = activeTabsStore.index("activeWindowId");
    const activeSpaceIdIndexForActiveTabs = activeTabsStore.index("activeSpaceId");

    await Promise.all(
      ids.map(async (activeWindowId) => {
        // FIXME: use proper indexedDB querying to get the non-grouped tabs instead of using Array.filter
        const nonGroupedTabs = (await activeWindowIdIndexForActiveTabs.getAll(activeWindowId)).filter(
          (activeTab) => activeTab.activeSpaceId === null
        );
        activeNonGroupedActiveTabsByWindowId[activeWindowId] = nonGroupedTabs;

        const activeSpaces = await activeWindowIdIndexForActiveSpaces.getAll(activeWindowId);
        activeSpacesByActiveWindowId[activeWindowId] = activeSpaces;

        await Promise.all(
          activeSpaces.map(async (activeSpace) => {
            const activeTabs = await activeSpaceIdIndexForActiveTabs.getAll(activeSpace.id);
            activeTabsByActiveSpaceId[activeSpace.id] = activeTabs;
          })
        );
      })
    );
    await transaction.done;

    return { activeSpacesByActiveWindowId, activeTabsByActiveSpaceId, activeNonGroupedActiveTabsByWindowId };
  }
}
