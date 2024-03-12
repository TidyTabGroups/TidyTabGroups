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

export async function getKey(
  id: Types.ActiveWindow["windowId"],
  _transaction?: IDBPTransaction<Types.ModelDataBase, ["activeWindows", ...StoreNames<Types.ModelDataBase>[]], "readonly">
) {
  const [transaction] = await Database.useOrCreateTransaction("model", _transaction, ["activeWindows"], "readonly");
  return await transaction.objectStore("activeWindows").getKey(id);
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

  const tabs = (await chrome.tabs.query({ windowId })) as ChromeTabWithId[];
  const selectedTab = tabs.find((tab) => tab.active);
  if (!selectedTab) {
    throw new Error(`activateWindow::window with id ${windowId} has no active tab`);
  }
  const tabGroups = await ChromeWindowHelper.getTabGroupsOrdered(tabs);

  // adjust the "shape" of the new active window, using the following adjustments:
  // 1. collapse all but the selected tab group
  // 2. un-collapse the selected tab group
  // 3. start the primary tab trigger for the active tab

  // adjustment 1
  const remaingTabGroupsToCollapse = tabGroups.filter((tabGroup) => tabGroup.id !== selectedTab.groupId);
  const collapseNextTabGroup = async () => {
    const tabGroup = remaingTabGroupsToCollapse.pop();
    if (!tabGroup) {
      return;
    }

    if (!tabGroup.collapsed) {
      await ChromeWindowHelper.updateTabGroupAndWait(tabGroup.id, { collapsed: true });
    }
    await collapseNextTabGroup();
  };

  await collapseNextTabGroup();

  // adjustment 2
  const selectedTabGroup = tabGroups.find((tabGroup) => tabGroup.id === selectedTab.groupId);
  if (selectedTabGroup && selectedTabGroup.collapsed) {
    await ChromeWindowHelper.updateTabGroupAndWait(selectedTabGroup.id, { collapsed: false });
  }

  // adjustment 3
  await enablePrimaryTabTriggerForTab(selectedTab.id);

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

export async function enablePrimaryTabTriggerForTab(tabOrTabId: ChromeTabId | ChromeTabWithId, makePrimaryNow = false) {
  const tab = await Misc.getTabFromTabOrTabId(tabOrTabId);
  if (tab.status !== "complete") {
    await ChromeWindowHelper.waitForTabToLoad(tab);
  }

  chrome.tabs.sendMessage(tab.id, { type: "enablePrimaryTabTrigger" }, async () => {
    if (chrome.runtime.lastError) {
      console.warn(`enablePrimaryTabTriggerForTab::chrome.runtime.lastError for ${tab.id}:`, chrome.runtime.lastError.message);
      // if the connection to the tab is invalid, or if the tab cant run content scripts (e.g chrome://*, the chrome web
      //  store, and accounts.google.com), then just set the primary tab group right now without waiting for the trigger
      if (makePrimaryNow) {
        setPrimaryTab(tab.windowId, tab.id);
      } else {
        // TODO: set the primary tab after timeout period using offscreen document
      }
    }
  });
}
