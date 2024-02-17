import {
  DataModel,
  ChromeTabGroupWithId,
  ChromeTabId,
  ChromeWindowId,
  ChromeWindowWithId,
  ChromeTabWithId,
  ChromeTabGroupId,
} from "../../types";
import * as Utils from "../../utils";

export async function onActionClicked(tab: chrome.tabs.Tab) {
  const { windowId } = tab;
  const activeWindows = await Utils.DataModel.ActiveWindow.getAll();
  if (!activeWindows.find((window) => window.windowId === windowId)) {
    const newActiveWindow = await Utils.DataModel.ActiveWindow.activateWindow(windowId);
    console.log(`onActionClicked::newActiveWindow: ${newActiveWindow}`);
    await Utils.DataModel.ActiveWindow.set(newActiveWindow);
  }
}

export async function onAlarm(alarm: chrome.alarms.Alarm) {
  if (alarm.name.startsWith("spaceAutoCollapseTimer")) {
    const spaceAutoCollapseAlarmId = alarm.name.split(":")[1];
    if (!spaceAutoCollapseAlarmId) {
      const errorMessage = `onAlarm: No spaceAutoCollapseAlarm id found in alarm name`;
      console.error(errorMessage);
      throw new Error(errorMessage);
    }

    const autoCollapseTimer = await Utils.DataModel.SpaceAutoCollapseTimer.get(
      spaceAutoCollapseAlarmId
    );

    if (!autoCollapseTimer) {
      const errorMessage = `onAlarm: No autoCollapseTimer found`;
      console.error(errorMessage);
      throw new Error(errorMessage);
    }

    const { activeWindowId, spaceId } = autoCollapseTimer;
    const space = await Utils.DataModel.ActiveWindowSpace.get(activeWindowId, spaceId);

    // TODO: if the space is not the primary space, make it the primary space
    await chrome.tabGroups.update(space.tabGroupInfo.id, { collapsed: true });
  }
}

export async function onInstalled(details: chrome.runtime.InstalledDetails) {
  console.log(`onInstalled::Extension was installed because of: ${details.reason}`);
  if (details.reason === "install") {
    await Utils.Storage.initialize();
    // TODO: open the onboarding page
  } else if (details.reason === "update") {
    await Utils.DataModel.ActiveWindow.reactivateWindowsForUpdate();
  }
}

export async function onStartUp() {
  console.log(`onStartUp::New browser session was started up`);
  await Utils.DataModel.ActiveWindow.reactivateWindowsForStartup();
}

export async function onTabGroupsUpdated(tabGroup: chrome.tabGroups.TabGroup) {
  console.log(`onTabGroupsUpdated::tabGroup: ${tabGroup}`);
  const activeWindows = await Utils.DataModel.ActiveWindow.getAll();

  const activeWindow = activeWindows.find((window) => window.windowId === tabGroup.windowId);

  if (!activeWindow) {
    return;
  }

  /*
    1 if: the updated tab group is the misc tab group:
      1.1 do: update the active window's misc tab group
      1.2 if: the tab group was expanded:
        1.2.1 do: activate the active tab candidate in the misc tab group
      1.3 if: the tab group was collapsed:
        1.3.1 do: activate the active tab candidate in the primary tab group
  */

  // if #1
  if (activeWindow.miscTabGroup?.id === tabGroup.id) {
    // do #1.1
    await Utils.DataModel.ActiveWindow.update(activeWindow.id, {
      miscTabGroup: tabGroup,
    });

    // if #1.2
    if (Utils.Misc.tabGroupWasExpanded(tabGroup, activeWindow.miscTabGroup)) {
      // do #1.2.1
      const tabsInMiscGroup = (await chrome.tabs.query({
        windowId: activeWindow.windowId,
        groupId: tabGroup.id,
      })) as ChromeTabWithId[];
      const activeTabCandidate = tabsInMiscGroup[tabsInMiscGroup.length - 1];
      await chrome.tabs.update(activeTabCandidate.id, { active: true });
    }
    // if #1.3
    else if (Utils.Misc.tabGroupWasCollapsed(tabGroup, activeWindow.miscTabGroup)) {
      // do #1.3.1
      const selectedActiveSpace = activeWindow.spaces.find(
        (activeSpace) => activeSpace.id === activeWindow.selectedSpaceId
      );
      if (!selectedActiveSpace) {
        const errorMessage = `onTabGroupsUpdated::Error: No active space found with id: ${activeWindow.selectedSpaceId}`;
        console.error(errorMessage);
        throw new Error(errorMessage);
      }
      const tabsInSelectedActiveSpaceTabGroup = (await chrome.tabs.query({
        windowId: activeWindow.windowId,
        groupId: selectedActiveSpace.tabGroupInfo.id,
      })) as ChromeTabWithId[];
      const activeTabCandidate = tabsInSelectedActiveSpaceTabGroup[0];
      await chrome.tabs.update(activeTabCandidate.id, { active: true });
    }

    return;
  }

  const activeSpaceFindResult =
    await Utils.DataModel.ActiveWindowSpace.findActiveSpaceForChromeObject<"tabGroup">(
      tabGroup.windowId,
      tabGroup
    );

  if (!activeSpaceFindResult) {
    return;
  }

  const { activeSpace, type: activeSpaceTabGroupType } = activeSpaceFindResult;

  await Utils.DataModel.ActiveWindowSpace.syncActiveSpaceWithWindow({
    activeWindow,
    activeSpace,
    type: "tabGroup",
    data: tabGroup,
  });
}

function onSpaceNotInTidyTabsShape(space: DataModel.Space) {
  // TODO: implement this
  console.log(`onSpaceNotInTidyTabsShape::space: ${space}`);
}
