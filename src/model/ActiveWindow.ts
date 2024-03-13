import { IDBPTransaction, StoreNames } from "idb";
import Database from "../database";
import Types from "../types";
import {
  ChromeWindowWithId,
  ChromeWindowId,
  ChromeTabWithId,
  ChromeTabGroupWithId,
  ChromeTabGroupId,
  ChromeTabId,
  YesOrNoOrNA,
} from "../types/types";
import * as ActiveTabGroup from "./ActiveTabGroup";
import Misc from "../misc";
import ChromeWindowHelper from "../chromeWindowHelper";
import { callWithUserTabDraggingHandler } from "../chromeWindowHelper/chromeWindowHelper";

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

  const uncollapsedTabGroups = (await chrome.tabGroups.query({ windowId, collapsed: false })) as ChromeTabGroupWithId[];
  uncollapsedTabGroups.forEach(async (tabGroup) => {
    if (tabGroup.id !== tab.groupId) {
      await ChromeWindowHelper.updateTabGroupAndWait(tabGroup.id, { collapsed: true });
    }
  });
}

export async function activatePrimaryTab(windowIdOrTabs: ChromeWindowId | ChromeTabWithId[]) {
  const tabs = Array.isArray(windowIdOrTabs) ? windowIdOrTabs : ((await chrome.tabs.query({ windowId: windowIdOrTabs })) as ChromeTabWithId[]);
  const lastTab = tabs[tabs.length - 1];
  if (lastTab) {
    if (lastTab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE) {
      await ChromeWindowHelper.updateTabGroupAndWait(lastTab.groupId, { collapsed: false });
    }
    await ChromeWindowHelper.activateTabAndWait(lastTab.id);
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

export async function manuallyActivateTab(tabToManuallyActivateId: ChromeTabId, tabToDiscardId?: ChromeTabId) {
  let didManuallyUncollapseTabGroup: YesOrNoOrNA = "no";
  const tabToManuallyActivate = (await chrome.tabs.get(tabToManuallyActivateId)) as ChromeTabWithId;
  const tabToManuallyActivateIsInTabGroup = tabToManuallyActivate.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE;
  if (tabToManuallyActivateIsInTabGroup) {
    const tabToManuallyActivateTabGroup = await chrome.tabGroups.get(tabToManuallyActivate.groupId);
    if (tabToManuallyActivateTabGroup.collapsed) {
      didManuallyUncollapseTabGroup = "yes";
      console.log(`manuallyActivateTab::manually uncollapsing tab group for tab:`, tabToManuallyActivateId);
      await ChromeWindowHelper.updateTabGroupAndWait(tabToManuallyActivateTabGroup.id, { collapsed: false });
    }
  } else {
    didManuallyUncollapseTabGroup = "n/a";
  }
  console.log(`manuallyActivateTab::manually activating ${tabToManuallyActivateId}. Manually uncollapse tab group: ${didManuallyUncollapseTabGroup}`);
  await ChromeWindowHelper.activateTabAndWait(tabToManuallyActivateId);

  if (tabToDiscardId !== undefined) {
    console.log(`manuallyActivateTab::discarding tab:`, tabToDiscardId);
    await ChromeWindowHelper.discardTabIfNotDiscarded(tabToDiscardId);
  }
}

export async function updateTabOpenerIdToTabToActivateIfClosed(
  windowId: ChromeWindowId,
  tabInfo: { tabId: ChromeTabId; tabGroupId: ChromeTabGroupId; openerTabId: chrome.tabs.Tab["openerTabId"]; title: chrome.tabs.Tab["title"] }
) {
  const tabToActivateIfClosedId = await getTabToActivateIfTabClosed(windowId, tabInfo);
  if (tabToActivateIfClosedId !== undefined && tabInfo.openerTabId !== tabToActivateIfClosedId) {
    const tabToActivateIfClosed = (await chrome.tabs.get(tabToActivateIfClosedId)) as ChromeTabWithId;
    console.log(
      `updateTabOpenerIdToTabToActivateIfClosed::setting tab to activate if closed for ${tabInfo.title || tabInfo.tabId} to ${
        tabToActivateIfClosed.title || tabInfo.tabId
      }`
    );
    return (await callWithUserTabDraggingHandler(() => {
      return chrome.tabs.update(tabInfo.tabId, { openerTabId: tabToActivateIfClosedId });
    })) as ChromeTabWithId;
  }
}

export async function getTabToActivateIfTabClosed(
  windowIdOrTabs: ChromeWindowId | ChromeTabWithId[],
  tabInfo: { tabId: ChromeTabId; tabGroupId: ChromeTabGroupId }
) {
  const windowId = typeof windowIdOrTabs === "number" ? windowIdOrTabs : windowIdOrTabs[0].windowId;
  const tabs = typeof windowIdOrTabs === "number" ? ((await chrome.tabs.query({ windowId })) as ChromeTabWithId[]) : windowIdOrTabs;
  let tabToActivateIfClosedId: ChromeTabId | undefined;
  const lastTabInWindow = tabs[tabs.length - 1];
  const isLastTabInWindow = lastTabInWindow.id === tabInfo.tabId;

  if (isLastTabInWindow) {
    const secondLastTabInWindow = tabs[tabs.length - 2];
    tabToActivateIfClosedId = secondLastTabInWindow.id;
  } else if (tabInfo.tabGroupId === chrome.tabGroups.TAB_GROUP_ID_NONE) {
    tabToActivateIfClosedId = lastTabInWindow.id;
  } else {
    const tabsInGroup = tabs.filter((tabInGroup) => tabInfo.tabGroupId === tabInGroup.groupId);
    const lastTabInGroup = tabsInGroup[tabsInGroup.length - 1];
    const firstTabInGroup = tabsInGroup[0];
    const tabBeforeTabGroup = tabs[firstTabInGroup.index - 1] as ChromeTabWithId | undefined;

    const tabGroups = await ChromeWindowHelper.getTabGroupsOrdered(tabs);
    const isLastTabGroup = tabGroups[tabGroups.length - 1].id === tabInfo.tabGroupId;

    if (tabsInGroup.length > 1) {
      const isLastTabInGroup = lastTabInGroup.id === tabInfo.tabId;
      if (isLastTabInGroup) {
        const secondLastTabInGroup = tabsInGroup[tabsInGroup.length - 2];
        tabToActivateIfClosedId = secondLastTabInGroup.id;
      }
    } else {
      if (isLastTabGroup) {
        tabToActivateIfClosedId = tabBeforeTabGroup?.id;
      } else {
        tabToActivateIfClosedId = lastTabInWindow.id;
      }
    }
  }

  return tabToActivateIfClosedId;
}

export async function getTabToActivateIfTabGroupCollapsed(windowIdOrTabs: ChromeWindowId | ChromeTabWithId[], tabGroupId: ChromeTabGroupId) {
  if (tabGroupId === chrome.tabGroups.TAB_GROUP_ID_NONE) {
    throw new Error(`getTabToActivateIfTabGroupCollapsed::tabGroupId is not valid: ${tabGroupId}`);
  }

  const windowId = typeof windowIdOrTabs === "number" ? windowIdOrTabs : windowIdOrTabs[0].windowId;
  const tabs = typeof windowIdOrTabs === "number" ? ((await chrome.tabs.query({ windowId })) as ChromeTabWithId[]) : windowIdOrTabs;

  let tabToActivateIfTabGroupCollapsedId: ChromeTabId | undefined;
  // if the tab group is at the end, activate the tab before the tab group. Otherwise, active the last tab in the window
  const lastTabInWindow = tabs[tabs.length - 1];
  const tabGroupIsAtEnd = lastTabInWindow.groupId === tabGroupId;
  if (tabGroupIsAtEnd) {
    const firstTabInGroup = tabs.find((_tab) => _tab.groupId === tabGroupId);
    if (!firstTabInGroup) {
      throw new Error(`getTabToActivateIfTabGroupCollapsed::firstTabInGroup not found for tabGroupId: ${tabGroupId}`);
    }
    const tabBeforeTabGroup = tabs[firstTabInGroup.index - 1] as ChromeTabWithId | undefined;
    tabToActivateIfTabGroupCollapsedId = tabBeforeTabGroup?.id;
  } else {
    tabToActivateIfTabGroupCollapsedId = lastTabInWindow.id;
  }

  return tabToActivateIfTabGroupCollapsedId;
}
