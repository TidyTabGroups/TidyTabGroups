import { ActiveWindow } from "../model";
import { ChromeTabGroupWithId, ChromeTabId, ChromeTabWithId, ChromeWindowId } from "../types/types";
import ChromeWindowHelper from "../chromeWindowHelper";

let newTabGroupingOperationInfo: { tabId: ChromeTabId; groupingOperationPromise: Promise<void> } | null = null;

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

  if (newTabGroupingOperationInfo && newTabGroupingOperationInfo.tabId === activeInfo.tabId) {
    await newTabGroupingOperationInfo.groupingOperationPromise;
  }

  const tab = (await chrome.tabs.get(activeInfo.tabId)) as ChromeTabWithId;
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
    await ActiveWindow.enablePrimaryTabTriggerForTab(tab.id);
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
      groupingOperationPromise: new Promise<void>(async (resolve, reject) => {
        try {
          const uncollapsedTabGroups = await chrome.tabGroups.query({ windowId: tab.windowId, collapsed: false });
          const selectedTabGroup = uncollapsedTabGroups[0];
          await chrome.tabs.group({ tabIds: tab.id, groupId: selectedTabGroup.id });
          resolve();
        } catch (error) {
          reject(`onTabCreated::tabGroupIdPromise::error resolving promise with selected tab group:${error}`);
        } finally {
          newTabGroupingOperationInfo = null;
        }
      }),
    };
  }
}
