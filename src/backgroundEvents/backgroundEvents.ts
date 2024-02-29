import { ActiveWindow, ActiveTabGroup, ActiveTabGroupAutoCollapseTimer } from "../model";
import Misc from "../misc";
import { ChromeTabWithId } from "../types/types";

export async function onAlarm(alarm: chrome.alarms.Alarm) {
  console.log(`onAlarm::alarm:`, alarm.name);
  debugger;
  if (alarm.name.startsWith(Misc.ACTIVE_TAB_GROUP_AUTO_COLLAPSE_TIMER_BASE_NAME)) {
    const activeTabGroupIdString = alarm.name.split(":")[1];
    if (!activeTabGroupIdString) {
      throw new Error(`onAlarm: No tab group id found in alarm name`);
    }

    const activeTabGroupId = parseInt(activeTabGroupIdString);
    const autoCollapseTimer = await ActiveTabGroupAutoCollapseTimer.getFromIndex("tabGroupId", activeTabGroupId);
    if (!autoCollapseTimer) {
      throw new Error(`onAlarm: No autoCollapseTimer found`);
    }

    await ActiveTabGroup.makePrimaryTabGroup(autoCollapseTimer.tabGroupId);

    await ActiveTabGroupAutoCollapseTimer.remove(autoCollapseTimer.id);
  }
}

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

    await ActiveWindow.setPrimaryTabGroup(tab.id, tab.groupId);
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
  try {
    await ActiveWindow.get(tabGroup.windowId);
  } catch (error) {
    return;
  }

  const activeTabGroup = await ActiveTabGroup.get(tabGroup.id);
  if (!activeTabGroup) {
    Misc.onWindowError(tabGroup.windowId);
    throw new Error(`onTabGroupsUpdated::activeTabGroup with id ${tabGroup.id} not found`);
  }

  const existingActiveTabGroupAutoCollapseTimer = await ActiveTabGroupAutoCollapseTimer.getFromIndex("windowId", tabGroup.windowId);
  if (existingActiveTabGroupAutoCollapseTimer) {
    chrome.alarms.clear(`${Misc.ACTIVE_TAB_GROUP_AUTO_COLLAPSE_TIMER_BASE_NAME}:${existingActiveTabGroupAutoCollapseTimer.tabGroupId}`);
    await ActiveTabGroupAutoCollapseTimer.remove(existingActiveTabGroupAutoCollapseTimer.id);
  }

  const wasCollapsed = tabGroup.collapsed && !activeTabGroup.collapsed;
  const wasExpanded = !tabGroup.collapsed && activeTabGroup.collapsed;

  if (wasExpanded) {
    // activate the last tab in the tab group
    const tabs = (await chrome.tabs.query({ groupId: tabGroup.id })) as ChromeTabWithId[];
    const lastTab = tabs[tabs.length - 1];
    let shouldSetPrimaryTabGroupNow = false;
    await new Promise<void>((resolve) => {
      chrome.tabs.sendMessage(lastTab.id, { type: "enableAutoCollapseTrigger" }, () => {
        if (chrome.runtime.lastError?.message === "Could not establish connection. Receiving end does not exist.") {
          console.warn(`onTabGroupsUpdated::onTabGroupsUpdated::chrome.tabs.sendMessage::Receiving end does not exist for tab:`, lastTab);
          // if the connection to the tab is invalid, or if the tab cant run content scripts (e.g chrome://*, the chrome web
          //  store, and accounts.google.com), then just set the primary tab group right now without waiting for the trigger
          shouldSetPrimaryTabGroupNow = true;
        }
        resolve();
      });
    });
    await Misc.activateTabAndWait(lastTab.id);

    const primaryTabGroup = await ActiveWindow.getPrimaryTabGroup(tabGroup.windowId);
    if (primaryTabGroup !== null && primaryTabGroup.id !== tabGroup.id) {
      await Misc.updateTabGroupAndWait(primaryTabGroup.id, { collapsed: true });
    }

    if (shouldSetPrimaryTabGroupNow) {
      await ActiveWindow.setPrimaryTabGroup(lastTab.id, lastTab.groupId);
    }
  }

  await ActiveTabGroup.update(tabGroup.id, tabGroup);
}
