import { ActiveWindow } from "../model";
import { ChromeTabGroupId, ChromeTabGroupWithId, ChromeTabId, ChromeTabWithId, ChromeWindowId, LastActiveTabInfo } from "../types/types";
import ChromeWindowHelper from "../chromeWindowHelper";

let newTabGroupingOperationInfo: { tabId: ChromeTabId; groupingOperationPromise: Promise<ChromeTabGroupId> } | null = null;
let lastActiveTabInfo: Promise<LastActiveTabInfo> | LastActiveTabInfo = new Promise(async (resolve, reject) => {
  try {
    const [activeTab] = (await chrome.tabs.query({
      active: true,
      lastFocusedWindow: true,
    })) as ChromeTabWithId[];
    resolve({ tabId: activeTab.id, tabGroupId: activeTab.groupId });
  } catch (error) {
    reject(`lastActiveTabInfo::error:${error}`);
  }
});

export async function onInstalled(details: chrome.runtime.InstalledDetails) {
  console.log(`onInstalled::Extension was installed because of: ${details.reason}`);
  if (details.reason === "install") {
    // TODO: open the onboarding page
  }

  const newActiveWindows = await ActiveWindow.reactivateAllWindows();
  console.log(`onInstalled::reactivated all windows:`, newActiveWindows);

  // inject the content script into all tabs
  const tabs = (await chrome.tabs.query({})) as ChromeTabWithId[];
  for (const tab of tabs) {
    chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["js/content_script.js"] });
  }

  // Misc.openDummyTab();
}

export async function onMessage(message: any, sender: chrome.runtime.MessageSender, sendResponse: (response?: any) => void) {
  if (!message || !message.type || !message.data) {
    console.warn("onMessage::message is not valid:", message);
    return;
  }

  console.log(`onMessage::message:`, message);

  if (message.type === "primaryTabTrigger") {
    const { tab } = sender;
    if (!tab || !tab.id || tab.pinned) {
      console.warn("onMessage::primaryTabTrigger::sender.tab is not valid:", sender);
      return;
    }
    const { triggerType } = message.data;
    console.log(`onMessage::primaryTabTrigger::triggerType:`, triggerType);

    ActiveWindow.setPrimaryTab(tab.windowId, tab.id);
  }
}

export async function onWindowCreated(window: chrome.windows.Window) {
  if (window.type !== "normal" || !window.id) {
    return;
  }
  console.log(`onWindowCreated::window:`, window);
  const newActiveWindow = await ActiveWindow.activateWindow(window.id);
  console.log(`onWindowCreated::newActiveWindow:`, newActiveWindow);
}

export async function onWindowRemoved(windowId: ChromeWindowId) {
  console.log(`onWindowRemoved::windowId:`, windowId);
  await ActiveWindow.remove(windowId);
  console.log(`onWindowRemoved::removedActiveWindow:`, windowId);
}

export async function onTabGroupsUpdated(tabGroup: chrome.tabGroups.TabGroup) {
  const activeWindowId = await ActiveWindow.getKey(tabGroup.windowId);
  if (!activeWindowId) {
    console.warn(`onTabGroupsUpdated::activeWindow not found for windowId:`, tabGroup.windowId);
    return;
  }

  console.log(`onTabGroupsUpdated::tabGroup:`, tabGroup.title, tabGroup.collapsed, tabGroup.color);
  const tabs = (await chrome.tabs.query({ windowId: tabGroup.windowId })) as ChromeTabWithId[];
  if (!tabGroup.collapsed) {
    // if the active tab isnt already in this group, activate the last tab in the group
    const tabsInGroup = tabs.filter((tab) => tab.groupId === tabGroup.id);
    const activeTabInGroup = tabsInGroup.find((tab) => tab.active);
    if (!activeTabInGroup) {
      const lastTabInGroup = tabsInGroup[tabsInGroup.length - 1];
      await ChromeWindowHelper.activateTabAndWait(lastTabInGroup.id);
    }
  }
}

export async function onTabActivated(activeInfo: chrome.tabs.TabActiveInfo) {
  const activeWindowId = await ActiveWindow.getKey(activeInfo.windowId);
  if (!activeWindowId) {
    console.warn(`onTabActivated::activeWindow not found for windowId:`, activeInfo.windowId);
    return;
  }

  let tab = (await chrome.tabs.get(activeInfo.tabId)) as ChromeTabWithId;
  lastActiveTabInfo = { tabId: tab.id, tabGroupId: tab.groupId };

  let shouldMakePrimaryNow: boolean;
  if (newTabGroupingOperationInfo && newTabGroupingOperationInfo.tabId === activeInfo.tabId) {
    lastActiveTabInfo.tabGroupId = tab.groupId = await newTabGroupingOperationInfo.groupingOperationPromise;
    shouldMakePrimaryNow = true;
  } else {
    shouldMakePrimaryNow = false;
  }

  console.log(`onTabActivated::`, tab.title, tab.groupId);
  const tabGroups = (await chrome.tabGroups.query({ windowId: tab.windowId, collapsed: false })) as ChromeTabGroupWithId[];
  const otherNonCollapsedTabGroups =
    tab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE ? tabGroups.filter((tabGroup) => tabGroup.id !== tab.groupId) : tabGroups;
  await Promise.all(
    otherNonCollapsedTabGroups.map(async (tabGroup) => {
      await ChromeWindowHelper.updateTabGroupAndWait(tabGroup.id, { collapsed: true });
    })
  );

  if (!tab.pinned) {
    await ActiveWindow.enablePrimaryTabTriggerForTab(tab.id, shouldMakePrimaryNow);
  }
}

export async function onTabCreated(tab: chrome.tabs.Tab) {
  const activeWindowId = await ActiveWindow.getKey(tab.windowId);
  if (!activeWindowId) {
    console.warn(`onTabCreated::activeWindow not found for windowId:`, tab.windowId);
    return;
  }

  if (!tab.id) {
    console.warn(`onTabCreated::tab.id is not valid:`, tab);
    return;
  }

  console.log(`onTabCreated::tab:`, tab.title, tab.groupId);

  if (tab.groupId === chrome.tabGroups.TAB_GROUP_ID_NONE) {
    newTabGroupingOperationInfo = {
      tabId: tab.id,
      groupingOperationPromise: new Promise(async (resolve, reject) => {
        try {
          const uncollapsedTabGroups = await chrome.tabGroups.query({ windowId: tab.windowId, collapsed: false });
          const selectedTabGroup = uncollapsedTabGroups[0];
          const tabGroupId = await chrome.tabs.group({ tabIds: tab.id, groupId: selectedTabGroup.id });
          resolve(tabGroupId);
        } catch (error) {
          reject(`onTabCreated::tabGroupIdPromise::error resolving promise with selected tab group:${error}`);
        } finally {
          newTabGroupingOperationInfo = null;
        }
      }),
    };
  }
}

export async function onTabGroupRemoved(tabGroup: ChromeTabGroupWithId) {
  const activeWindowId = await ActiveWindow.getKey(tabGroup.windowId);
  if (!activeWindowId) {
    console.warn(`onTabGroupRemoved::activeWindow not found for windowId:`, tabGroup.windowId);
    return;
  }

  console.log(`onTabGroupRemoved::`, tabGroup.title);
  if ((await lastActiveTabInfo).tabGroupId === tabGroup.id) {
    await ActiveWindow.activatePrimaryTab(tabGroup.windowId);
  }
}

export async function onTabRemoved(tabId: ChromeTabId, removeInfo: chrome.tabs.TabRemoveInfo) {
  const activeWindowId = await ActiveWindow.getKey(removeInfo.windowId);
  if (!activeWindowId) {
    console.warn(`onTabRemoved::activeWindow not found for windowId:`, removeInfo.windowId);
    return;
  }

  if (removeInfo.isWindowClosing) {
    console.log(`onTabRemoved::window is closing, nothing to do:`, tabId);
    return;
  }

  console.log(`onTabRemoved::tabId:`, tabId, removeInfo);
  // TODO: if this tab was at the end, and there is no other available tab that is in the second end position (i.e. the second last tab),
  // then set the new primary tab group, if it exists, similar to onTabGroupRemoved. This will require storing a copy of tabs and their indexes.
}

export async function onTabUpdated(tabId: ChromeTabId, changeInfo: chrome.tabs.TabChangeInfo, tab: chrome.tabs.Tab) {
  const activeWindowId = await ActiveWindow.getKey(tab.windowId);
  if (!activeWindowId) {
    console.warn(`onTabsUpdated::activeWindow not found for windowId:`, tab.windowId);
    return;
  }

  console.log(`onTabsUpdated::tabId:`, tabId, changeInfo, tab);
  // we check if the tab still exists because the chrome.tabs.onUpdated event gets called with groupId = -1 when the tab is removed, and we
  //  dont want to forget which tab group the removed tab belonged to in lastActiveTabInfo
  if ((await lastActiveTabInfo).tabId === tabId && changeInfo.groupId !== undefined && (await ChromeWindowHelper.doesTabExist(tabId))) {
    lastActiveTabInfo = { tabId, tabGroupId: changeInfo.groupId };
  }
}
