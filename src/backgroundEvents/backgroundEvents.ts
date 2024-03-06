import { ActiveWindow } from "../model";
import { ChromeTabGroupWithId, ChromeTabId, ChromeTabWithId } from "../types/types";
import ChromeWindowHelper from "../chromeWindowHelper";

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
}

export async function onTabGroupsUpdated(tabGroup: chrome.tabGroups.TabGroup) {
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
  const tab = (await chrome.tabs.get(activeInfo.tabId)) as ChromeTabWithId;
  console.log(`onTabActivated::`, tab.title);
  const tabGroups = (await chrome.tabGroups.query({ windowId: tab.windowId, collapsed: false })) as ChromeTabGroupWithId[];
  const otherNonCollapsedTabGroups =
    tab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE ? tabGroups.filter((tabGroup) => tabGroup.id !== tab.groupId) : tabGroups;
  await Promise.all(
    otherNonCollapsedTabGroups.map(async (tabGroup) => {
      await ChromeWindowHelper.updateTabGroupAndWait(tabGroup.id, { collapsed: true });
    })
  );

  if (!tab.pinned) {
    let triggerWasEnabled = await ActiveWindow.enablePrimaryTabTriggerForTab(tab.id);
    // if the connection to the tab is invalid, or if the tab cant run content scripts (e.g chrome://*, the chrome web
    //  store, and accounts.google.com), then just set the primary tab group right now without waiting for the trigger
    if (!triggerWasEnabled) {
      await ActiveWindow.setPrimaryTab(tab.windowId, tab.id);
    }
  }
}

export async function onTabCreated(tab: chrome.tabs.Tab) {
  const primaryTabGroup = await ActiveWindow.getPrimaryTabGroup(tab.windowId);
  if (!primaryTabGroup) {
    return;
  }

  const tabs = (await chrome.tabs.query({ windowId: tab.windowId })) as ChromeTabWithId[];
  if (tabs.length > 1 && tabs[tabs.length - 2].groupId === primaryTabGroup.id) {
    await chrome.tabs.group({ tabIds: tab.id, groupId: primaryTabGroup.id });
  }
}
