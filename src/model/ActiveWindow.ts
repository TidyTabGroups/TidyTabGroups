import { ChromeTabGroupId, ChromeTabGroupWithId, ChromeTabId, ChromeTabWithId, ChromeWindowId, ChromeWindowWithId, DataModel } from "../types";
import * as WindowMatcher from "../windowMatcher";
import * as Storage from "../storage";
import { v4 as uuidv4 } from "uuid";
import { ActiveWindowSpace } from "./ActiveWindowSpace";
import { ActiveWindowTab } from "./ActiveWindowTab";
import { SpaceAutoCollapseTimer } from "./SpaceAutoCollapseTimer";
import Database from "../database";
import { DBSchema, IDBPTransaction, IndexKey, IndexNames, StoreNames } from "idb";

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
    tabs: DataModel.ActiveTab[],
    _transaction?: IDBPTransaction<
      DataModel.ModelDB,
      ["activeWindows", "activeSpaces", "activeTabs", ...StoreNames<DataModel.ModelDB>[]],
      "readwrite"
    >
  ) {
    const [transaction, didProvideTransaction] = await Database.useOrCreateTransaction(
      "model",
      _transaction,
      ["activeWindows", "activeSpaces", "activeTabs"],
      "readwrite"
    );

    const activeWindowsStore = transaction.objectStore("activeWindows");
    const activeSpacesStore = transaction.objectStore("activeSpaces");
    const activeTabsStore = transaction.objectStore("activeTabs");

    const newActiveWindow = create(createProperties);
    activeWindowsStore.add(newActiveWindow);
    spaces.forEach((space) => activeSpacesStore.add(space));
    tabs.forEach((tab) => activeTabsStore.add(tab));

    if (!didProvideTransaction) {
      await transaction.done;
    }

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

  export async function getAllKeys(
    _transaction?: IDBPTransaction<DataModel.ModelDB, ["activeWindows", ...StoreNames<DataModel.ModelDB>[]], "readwrite" | "readonly">
  ) {
    const [transaction, didProvideTransaction] = await Database.useOrCreateTransaction("model", _transaction, ["activeWindows"], "readonly");
    const allKeys = await transaction.objectStore("activeWindows").getAllKeys();
    if (!didProvideTransaction) {
      await transaction.done;
    }
    return allKeys;
  }

  export async function getAllFromIndex<IndexName extends IndexNames<DataModel.ModelDB, "activeWindows">>(index: IndexName) {
    const modelDB = await Database.getDBConnection<DataModel.ModelDB>("model");
    return modelDB.getAllFromIndex<"activeWindows", IndexName>("activeWindows", index);
  }

  export async function add(activeWindow: DataModel.ActiveWindow) {
    const modelDB = await Database.getDBConnection<DataModel.ModelDB>("model");
    await modelDB.add("activeWindows", activeWindow);
  }

  export async function remove(
    id: string,
    _transaction?: IDBPTransaction<DataModel.ModelDB, ["activeWindows", ...StoreNames<DataModel.ModelDB>[]], "readwrite">
  ) {
    const [transaction, didProvideTransaction] = await Database.useOrCreateTransaction("model", _transaction, ["activeWindows"], "readwrite");
    await transaction.objectStore("activeWindows").delete(id);

    if (!didProvideTransaction) {
      await transaction.done;
    }
  }

  export async function removeAllCascading(
    activeWindowIds: string[],
    _transaction?: IDBPTransaction<DataModel.ModelDB, ["activeWindows", "activeSpaces", "activeTabs", "spaceAutoCollapseTimers"], "readwrite">
  ) {
    const [transaction, didProvideTransaction] = await Database.useOrCreateTransaction(
      "model",
      _transaction,
      ["activeWindows", "activeSpaces", "activeTabs", "spaceAutoCollapseTimers"],
      "readwrite"
    );

    await Promise.all(
      activeWindowIds.map(async (activeWindowId) => {
        await remove(activeWindowId, transaction);

        const activeWindowIndexForActiveSpaces = transaction.objectStore("activeSpaces").index("activeWindowId");
        const activeSpaceIds = await activeWindowIndexForActiveSpaces.getAllKeys(activeWindowId);
        await Promise.all(activeSpaceIds.map((activeSpaceId) => transaction.objectStore("activeSpaces").delete(activeSpaceId)));

        const activeWindowIndexForActiveTabs = transaction.objectStore("activeTabs").index("activeWindowId");
        const activeTabIds = await activeWindowIndexForActiveTabs.getAllKeys(activeWindowId);
        await Promise.all(activeTabIds.map((activeTabId) => transaction.objectStore("activeTabs").delete(activeTabId)));

        const activeWindowIndexForSpaceAutoCollapseTimers = transaction.objectStore("spaceAutoCollapseTimers").index("activeWindowId");
        const spaceAutoCollapseTimerIds = await activeWindowIndexForSpaceAutoCollapseTimers.getAllKeys(activeWindowId);
        await Promise.all(
          spaceAutoCollapseTimerIds.map((spaceAutoCollapseTimerId) =>
            transaction.objectStore("spaceAutoCollapseTimers").delete(spaceAutoCollapseTimerId)
          )
        );
      })
    );

    if (!didProvideTransaction) {
      await transaction.done;
    }
  }

  export async function update(id: string, updateProperties: Partial<DataModel.ActiveWindow>) {
    const modelDB = await Database.getDBConnection<DataModel.ModelDB>("model");
    const activeWindow = await get(id);
    await modelDB.put("activeWindows", { ...activeWindow, ...updateProperties, id });
  }

  export async function activateWindow(windowId: ChromeWindowId, primaryTabGroupId?: ChromeTabGroupId) {
    const window = (await chrome.windows.get(windowId)) as ChromeWindowWithId;
    if (!window) {
      throw new Error(`adjustAndExtractActiveWindowInfoForWindow::window with id ${window} not found`);
    }

    if (window.type !== "normal") {
      throw new Error(`adjustAndExtractActiveWindowInfoForWindow::window with id ${window} is not a normal window`);
    }

    const getTabsInfo = (tabs: ChromeTabWithId[]) => {
      let selectedTab: ChromeTabWithId | undefined;
      let nonGroupedTabs: ChromeTabWithId[] = [];
      tabs.forEach((tab) => {
        if (tab.groupId === chrome.tabGroups.TAB_GROUP_ID_NONE) {
          nonGroupedTabs.push(tab);
        }
        if (tab.active) {
          selectedTab = tab;
        }
      });
      if (!selectedTab) {
        throw new Error(`activateWindow::Error: No selected tab found`);
      }
      return {
        selectedTab,
        nonGroupedTabs,
      };
    };

    let tabGroups = await chrome.tabGroups.query({ windowId });
    let tabs = (await chrome.tabs.query({ windowId })) as ChromeTabWithId[];

    let { selectedTab, nonGroupedTabs } = getTabsInfo(tabs);

    // adjust the "shape" ofthe new active window, using the following adjustments:
    // 1. collapse all but the selected tab group
    // 2. move all non grouped tabs to before all the tab groups

    // adjustment 1
    tabGroups = await Promise.all(
      tabGroups.map(async (tabGroup) => {
        if (tabGroup.id !== selectedTab.groupId) {
          return await chrome.tabGroups.update(tabGroup.id, { collapsed: true });
        }
        return tabGroup;
      })
    );

    // adjustment 2
    if (nonGroupedTabs.length > 0) {
      await chrome.tabs.move(
        nonGroupedTabs.map((tab) => tab.id),
        { windowId, index: 0 }
      );
      tabs = (await chrome.tabs.query({ windowId })) as ChromeTabWithId[];
      const newTabsInfo = getTabsInfo(tabs);
      selectedTab = newTabsInfo.selectedTab;
      nonGroupedTabs = newTabsInfo.nonGroupedTabs;
    }

    const newActiveWindowId = uuidv4();
    let newActiveWindowSpaces: DataModel.ActiveSpace[] = [];
    let newActiveWindowTabs: DataModel.ActiveTab[] = [];
    let newActiveWindowSelectedSpaceId: DataModel.ActiveWindow["selectedSpaceId"] = null;
    let newActiveWindowPrimarySpaceId: DataModel.ActiveWindow["primarySpaceId"] = null;
    let newActiveWindowSelectedTabFocusType: DataModel.ActiveWindow["selectedSpaceFocusType"];
    let newActiveWindowSelectedTabId: DataModel.ActiveWindow["selectedTabId"] | undefined;

    if (selectedTab.groupId === chrome.tabGroups.TAB_GROUP_ID_NONE) {
      newActiveWindowSelectedTabFocusType = "nonSpaceTabFocus";
    } else if (selectedTab.groupId === primaryTabGroupId) {
      newActiveWindowSelectedTabFocusType = "primaryFocus";
    } else {
      newActiveWindowSelectedTabFocusType = "peakFocus";
    }

    nonGroupedTabs.forEach((tab) => {
      const newActiveWindowTab = ActiveWindowTab.createFromExistingTab(newActiveWindowId, null, tab);
      newActiveWindowTabs.push(newActiveWindowTab);
      if (selectedTab.id === tab.id) {
        newActiveWindowSelectedTabId = newActiveWindowTab.id;
      }
    });

    tabGroups.forEach((tabGroup) => {
      const isPrimaryTabGroup = primaryTabGroupId && tabGroup.id === primaryTabGroupId;
      const isSelectedTabGroup = tabGroup.id === selectedTab.groupId;

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

      if (isSelectedTabGroup) {
        newActiveWindowSelectedSpaceId = newActiveWindowSpace.id;
      }

      const tabsInGroup = tabs.filter((tab) => tab.groupId === tabGroup.id);
      tabsInGroup.forEach((tab) => {
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

    const transaction = await Database.createTransaction<
      DataModel.ModelDB,
      ["activeWindows", "activeSpaces", "activeTabs", "spaceAutoCollapseTimers"],
      "readwrite"
    >("model", ["activeWindows", "activeSpaces", "activeTabs", "spaceAutoCollapseTimers"], "readwrite");

    const newActiveWindow = await ActiveWindow.createAndAdd(
      {
        id: newActiveWindowId,
        windowId,
        selectedSpaceId: newActiveWindowSelectedSpaceId,
        primarySpaceId: newActiveWindowPrimarySpaceId,
        selectedSpaceFocusType: newActiveWindowSelectedTabFocusType,
        selectedTabId: newActiveWindowSelectedTabId,
      },
      newActiveWindowSpaces,
      newActiveWindowTabs,
      transaction
    );

    if (newActiveWindowSelectedTabFocusType === "peakFocus") {
      // FIXME: get rid of this type assertion when we have figured out a better way to handle it
      if (!newActiveWindowSelectedSpaceId) {
        throw new Error(`activateWindow::Error: No selected space found`);
      }
      await SpaceAutoCollapseTimer.startAutoCollapseTimerForSpace(newActiveWindow.id, newActiveWindowSelectedSpaceId, transaction);
    }

    await transaction.done;
    return newActiveWindow;
  }

  export async function reactivateAllWindows() {
    const transaction = await Database.createTransaction<
      DataModel.ModelDB,
      ["activeWindows", "activeSpaces", "activeTabs", "spaceAutoCollapseTimers"],
      "readwrite"
    >("model", ["activeWindows", "activeSpaces", "activeTabs", "spaceAutoCollapseTimers"], "readwrite");
    await removeAllCascading(await getAllKeys(transaction), transaction);

    const windows = (await chrome.windows.getAll()).filter((window) => window.type === "normal") as ChromeWindowWithId[];
    const newActiveWindows = await Promise.all(windows.map((window) => activateWindow(window.id)));
    await transaction.done;
    return newActiveWindows;
  }

  export async function reactivateWindowsForStartup() {
    try {
      const prevActiveWindows = await ActiveWindow.getAll();
      const windows = (await chrome.windows.getAll()) as ChromeWindowWithId[];
      const matchedWindowsToPrevActiveWindows = await WindowMatcher.matchWindowsToActiveWindows(windows, prevActiveWindows);

      await Promise.all(
        matchedWindowsToPrevActiveWindows.map(async (matchedWindowToPrevActiveWindowInfo) => {
          const { windowId, activeWindow: prevActiveWindow, matchedTabGroups } = matchedWindowToPrevActiveWindowInfo;

          const matchedPrimaryTabGroupInfo = prevActiveWindow.primarySpaceId
            ? matchedTabGroups.find((matchedTabGroupInfo) => matchedTabGroupInfo.activeSpaceId === prevActiveWindow.primarySpaceId)
            : undefined;

          const primaryTabGroupId = matchedPrimaryTabGroupInfo?.tabGroupId;

          await ActiveWindow.activateWindow(windowId);
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
          await ActiveWindow.activateWindow(window.id);
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
