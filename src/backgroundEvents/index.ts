import { DataModel, ChromeTabWithId } from "../types";
import { ActiveWindow, ActiveWindowSpace, SpaceAutoCollapseTimer } from "../model";
import * as Storage from "../storage";
import * as Misc from "../misc";

export async function onActionClicked(tab: chrome.tabs.Tab) {
  const { windowId } = tab;
  const activeWindows = await ActiveWindow.getAll();
  if (!activeWindows.find((window) => window.windowId === windowId)) {
    const newActiveWindow = await ActiveWindow.activateWindow(windowId);
    console.log(`onActionClicked::newActiveWindow: ${newActiveWindow}`);
  }
}

export async function onAlarm(alarm: chrome.alarms.Alarm) {
  console.log(`onAlarm::alarm:`, alarm.name);
  if (alarm.name.startsWith("spaceAutoCollapseTimer")) {
    const spaceAutoCollapseAlarmId = alarm.name.split(":")[1];
    if (!spaceAutoCollapseAlarmId) {
      const errorMessage = `onAlarm: No spaceAutoCollapseAlarm id found in alarm name`;
      console.error(errorMessage);
      throw new Error(errorMessage);
    }

    const autoCollapseTimer = await SpaceAutoCollapseTimer.get(spaceAutoCollapseAlarmId);
    if (!autoCollapseTimer) {
      const errorMessage = `onAlarm: No autoCollapseTimer found`;
      console.error(errorMessage);
      throw new Error(errorMessage);
    }

    SpaceAutoCollapseTimer.onAutoCollapseTimer(autoCollapseTimer.id);
  }
}

export async function onInstalled(details: chrome.runtime.InstalledDetails) {
  console.log(`onInstalled::Extension was installed because of: ${details.reason}`);
  if (details.reason === "install") {
    // TODO: open the onboarding page
  }

  const newActiveWindows = await ActiveWindow.reactivateAllWindows();
  console.log(`onInstalled::reactivated all windows:`, newActiveWindows);

  Misc.openDummyTab();
}

export async function onTabGroupsUpdated(tabGroup: chrome.tabGroups.TabGroup) {
  console.log(`onTabGroupsUpdated::tabGroup: ${tabGroup}`);
  const activeWindow = await ActiveWindow.getFromIndex("windowId", tabGroup.windowId);

  if (!activeWindow) {
    return;
  }

  const activeSpace = await ActiveWindowSpace.getFromIndex("tabGroupId", tabGroup.id);
  if (!activeSpace) {
    console.error(`onTabGroupsUpdated::Error: No active space found with tab group id: ${tabGroup.id}`);
    onSpaceNotInTidyTabsShape();
    return;
  }

  const isPrimaryTabGroup = activeWindow.primarySpaceId === activeSpace.id;

  const wasCollapsed = Misc.tabGroupWasCollapsed(tabGroup.collapsed, activeSpace.tabGroupInfo.collapsed);
  const wasExpanded = Misc.tabGroupWasExpanded(tabGroup.collapsed, activeSpace.tabGroupInfo.collapsed);

  if (wasExpanded) {
    await SpaceAutoCollapseTimer.startAutoCollapseTimerForSpace(activeWindow.id, activeSpace.id);
    // activate the last tab in the space
    const tabs = (await chrome.tabs.query({ groupId: tabGroup.id })) as ChromeTabWithId[];
    const lastTab = tabs[tabs.length - 1];
    await chrome.tabs.update(lastTab.id, { active: true });
  }

  await ActiveWindowSpace.update(activeSpace.id, { tabGroupInfo: tabGroup });
}

function onSpaceNotInTidyTabsShape() {
  // TODO: implement this
  console.log(`onSpaceNotInTidyTabsShape::`);
}
