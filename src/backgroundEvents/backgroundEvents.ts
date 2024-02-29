import { ActiveWindow } from "../model";
import Misc from "../misc";
import { ChromeTabGroupWithId, ChromeTabId, ChromeTabWithId } from "../types/types";

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
    chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, files: ["js/content_script.js"] });
  }

  Misc.openDummyTab();
}

export async function onMessage(message: any, sender: chrome.runtime.MessageSender, sendResponse: (response?: any) => void) {
  if (!message || !message.type || !message.data) {
    console.warn("onMessage::message is not valid:", message);
    return;
  }

  console.log(`onMessage::message:`, message);

  if (message.type === "primaryTabGroupTrigger") {
    const { tab } = sender;
    if (!tab || !tab.id) {
      console.warn("onMessage::primaryTabGroupTrigger::sender.tab is not valid:", sender.tab);
      return;
    }
    const { triggerType } = message.data;
    console.log(`onMessage::primaryTabGroupTrigger::triggerType:`, triggerType);

    if (tab.groupId === chrome.tabGroups.TAB_GROUP_ID_NONE) {
      console.warn(`onMessage::primaryTabGroupTrigger::tab is not in a tab group`);
      return;
    }

    ActiveWindow.setPrimaryTabAndTabGroup(tab.windowId, tab.id, tab.groupId);
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
  const tabGroupsOrdered = await Misc.getTabGroupsOrdered(tabs);
  const primaryTabGroup = tabGroupsOrdered[tabGroupsOrdered.length - 1] as ChromeTabGroupWithId | undefined;
  if (!tabGroup.collapsed && primaryTabGroup?.id !== tabGroup.id) {
    // if the active tab isnt already in this group, activate the last tab in the group
    const tabsInGroup = tabs.filter((tab) => tab.groupId === tabGroup.id);
    const activeTabInGroup = tabsInGroup.find((tab) => tab.active);
    if (!activeTabInGroup) {
      const lastTabInGroup = tabsInGroup[tabsInGroup.length - 1];
      await Misc.activateTabAndWait(lastTabInGroup.id);
    }

    if (primaryTabGroup) {
      await Misc.updateTabGroupAndWait(primaryTabGroup.id, { collapsed: true });
    }
  }
}

export async function onTabActivated(activeInfo: chrome.tabs.TabActiveInfo) {
  const tab = (await chrome.tabs.get(activeInfo.tabId)) as ChromeTabWithId;
  if (tab.groupId === chrome.tabGroups.TAB_GROUP_ID_NONE) {
    return;
  }
  console.log(`onTabActivated::`, tab.title);
  let triggerWasEnabled = await ActiveWindow.enableAutoCollapseTriggerForTab(tab.id);
  // if the connection to the tab is invalid, or if the tab cant run content scripts (e.g chrome://*, the chrome web
  //  store, and accounts.google.com), then just set the primary tab group right now without waiting for the trigger
  if (!triggerWasEnabled) {
    await ActiveWindow.setPrimaryTabAndTabGroup(tab.windowId, tab.id, tab.groupId);
  }
}
