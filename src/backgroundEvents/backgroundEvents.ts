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

  await chrome.storage.local.set({ hasActivated: false });
  const newActiveWindows = await ActiveWindow.reactivateAllWindows();
  console.log(`onInstalled::reactivated all windows:`, newActiveWindows);
  await chrome.storage.local.set({ hasActivated: true });

  Misc.openDummyTab();
}

export async function onTabGroupsUpdated(tabGroup: chrome.tabGroups.TabGroup) {
  const { hasActivated } = (await chrome.storage.local.get("hasActivated")) as { hasActivated: boolean };
  if (!hasActivated) {
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
    await Misc.activateTabAndWait(lastTab.id);

    const primaryTabGroup = await ActiveWindow.getPrimaryTabGroup(tabGroup.windowId);
    if (primaryTabGroup !== null && primaryTabGroup.id !== tabGroup.id) {
      await Misc.updateTabGroupAndWait(primaryTabGroup.id, { collapsed: true });
      await chrome.tabGroups.move(tabGroup.id, { index: -1 });
    } else if (wasCollapsed) {
    }
  }

  await ActiveTabGroup.update(tabGroup.id, tabGroup);
}
