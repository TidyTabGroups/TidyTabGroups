import { IDBPTransaction, StoreNames } from "idb";
import Database from "../database";
import Types from "../types";
import { ChromeWindowWithId, ChromeWindowId, ChromeTabWithId, ChromeTabGroupWithId, ChromeTabGroupId, ChromeTabId } from "../types/types";
import * as ActiveTabGroup from "./ActiveTabGroup";
import Misc from "../misc";
import ChromeWindowHelper from "../chromeWindowHelper";

export async function get(
  id: Types.ActiveWindow["windowId"],
  _transaction?: IDBPTransaction<Types.ModelDataBase, ["activeWindows", ...StoreNames<Types.ModelDataBase>[]], "readonly" | "readwrite">
) {
  const [transaction] = await Database.useOrCreateTransaction("model", _transaction, ["activeWindows"], "readonly");
  const activeWindow = await transaction.objectStore("activeWindows").get(id);
  if (!activeWindow) {
    throw new Error(`ActiveWindow::get with id ${id} not found`);
  }

  return activeWindow;
}

export async function add(
  activeWindow: Types.ActiveWindow,
  _transaction?: IDBPTransaction<Types.ModelDataBase, ["activeWindows", ...StoreNames<Types.ModelDataBase>[]], "readwrite">
) {
  const [transaction, didProvideTransaction] = await Database.useOrCreateTransaction("model", _transaction, ["activeWindows"], "readwrite");
  await transaction.objectStore("activeWindows").add(activeWindow);

  if (!didProvideTransaction) {
    await transaction.done;
  }

  return activeWindow;
}

export async function remove(
  id: Types.ActiveWindow["windowId"],
  _transaction?: IDBPTransaction<Types.ModelDataBase, ["activeWindows", ...StoreNames<Types.ModelDataBase>[]], "readwrite">
) {
  const [transaction, didProvideTransaction] = await Database.useOrCreateTransaction("model", _transaction, ["activeWindows"], "readwrite");

  const key = await transaction.objectStore("activeWindows").getKey(id);
  if (!key) {
    throw new Error(`ActiveWindow::remove with id ${id} not found`);
  }

  await transaction.objectStore("activeWindows").delete(id);

  if (!didProvideTransaction) {
    await transaction.done;
  }
}

export async function update(
  id: Types.ActiveWindow["windowId"],
  updatedProperties: Partial<Types.ActiveWindow>,
  _transaction?: IDBPTransaction<Types.ModelDataBase, ["activeWindows", ...StoreNames<Types.ModelDataBase>[]], "readwrite">
) {
  const [transaction, didProvideTransaction] = await Database.useOrCreateTransaction("model", _transaction, ["activeWindows"], "readwrite");

  const activeWindow = await get(id, transaction);

  await transaction.objectStore("activeWindows").put({ ...activeWindow, ...updatedProperties });

  if (!didProvideTransaction) {
    await transaction.done;
  }
}

export async function reactivateAllWindows() {
  const allObjectStores: Array<"activeWindows" | "activeTabGroups"> = ["activeWindows", "activeTabGroups"];
  const transaction = await Database.createTransaction<Types.ModelDataBase, typeof allObjectStores, "readwrite">(
    "model",
    allObjectStores,
    "readwrite"
  );
  await Promise.all(allObjectStores.map((store) => transaction.objectStore(store).clear()));
  await transaction.done;

  await activateAllWindows();
}

export async function activateAllWindows() {
  const windows = (await chrome.windows.getAll()) as ChromeWindowWithId[];
  await Promise.all(windows.map((window) => activateWindow(window.id)));
}

export async function activateWindow(windowId: ChromeWindowId) {
  const window = (await chrome.windows.get(windowId)) as ChromeWindowWithId;
  if (!window) {
    throw new Error(`activateWindow::window with id ${window} not found`);
  }

  if (window.type !== "normal") {
    throw new Error(`activateWindow::window with id ${window} is not a normal window`);
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

  let tabs = (await chrome.tabs.query({ windowId })) as ChromeTabWithId[];
  let tabGroups = await ChromeWindowHelper.getTabGroupsOrdered(tabs);
  const primaryTabGroupId = tabGroups.length > 0 ? tabGroups[tabGroups.length - 1].id : null;

  let { selectedTab, nonGroupedTabs } = getTabsInfo(tabs);

  // adjust the "shape" of the new active window, using the following adjustments:
  // 1. collapse all but the selected tab group
  // 2. move all non grouped tabs to before all the tab groups
  // 3. move the selected tab group to the end position, making it the new primary tab group

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
    const pinnedTabs = nonGroupedTabs.filter((tab) => tab.pinned);
    await chrome.tabs.move(
      nonGroupedTabs.map((tab) => tab.id),
      { windowId, index: pinnedTabs.length }
    );
    tabs = (await chrome.tabs.query({ windowId })) as ChromeTabWithId[];
    const newTabsInfo = getTabsInfo(tabs);
    selectedTab = newTabsInfo.selectedTab;
    nonGroupedTabs = newTabsInfo.nonGroupedTabs;
  }

  // adjustment 3
  if (selectedTab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE && selectedTab.groupId !== primaryTabGroupId) {
    await chrome.tabGroups.move(selectedTab.groupId, { index: -1 });
  }

  const transaction = await Database.createTransaction<Types.ModelDataBase, ["activeWindows", "activeTabGroups"], "readwrite">(
    "model",
    ["activeWindows", "activeTabGroups"],
    "readwrite"
  );
  await add({ windowId }, transaction);
  await Promise.all(
    tabGroups.map((tabGroup) => {
      ActiveTabGroup.add(tabGroup, transaction);
    })
  );

  return tabGroups;
}

export async function getPrimaryTabGroup(windowId: ChromeWindowId) {
  const tabGroupsOrdered = await ChromeWindowHelper.getTabGroupsOrdered(windowId);
  return tabGroupsOrdered.length > 0 ? tabGroupsOrdered[tabGroupsOrdered.length - 1] : null;
}

export async function setPrimaryTab(windowId: ChromeWindowId, tabId: ChromeTabId) {
  const tabs = (await chrome.tabs.query({ windowId })) as ChromeTabWithId[];
  const tab = tabs.find((tab) => tab.id === tabId);
  if (!tab) {
    throw new Error(`setPrimaryTab::tabId ${tabId} not found in windowId ${windowId}`);
  }

  let shouldMoveTab = false;
  if (tab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE) {
    const tabsInGroup = tabs.filter((otherTab) => otherTab.groupId === tab.groupId);
    const lastTabInGroup = tabsInGroup[tabsInGroup.length - 1];
    if (lastTabInGroup.index < tabs[tabs.length - 1].index) {
      await ChromeWindowHelper.moveTabGroupAndWait(tab.groupId, { index: -1 });
    }

    if (tab.index < lastTabInGroup.index) {
      shouldMoveTab = true;
    }
  } else if (tab.index < tabs[tabs.length - 1].index) {
    shouldMoveTab = true;
  }

  if (shouldMoveTab) {
    await ChromeWindowHelper.moveTabAndWait(tabId, { index: -1 });
  }
}

export async function enablePrimaryTabTriggerForTab(tabOrTabId: ChromeTabId | ChromeTabWithId) {
  const tab = await Misc.getTabFromTabOrTabId(tabOrTabId);
  if (tab.status !== "complete") {
    await ChromeWindowHelper.waitForTabToLoad(tab);
  }

  return new Promise<boolean>((resolve) => {
    chrome.tabs.sendMessage(tab.id, { type: "enablePrimaryTabTrigger" }, () => {
      if (chrome.runtime.lastError) {
        console.warn(`enablePrimaryTabTriggerForTab::chrome.runtime.lastError for ${tab.id}:`, chrome.runtime.lastError.message);
        resolve(false);
      }
      resolve(true);
    });
  });
}
