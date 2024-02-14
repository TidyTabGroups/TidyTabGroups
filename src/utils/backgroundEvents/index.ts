import { TidyTabs, ChromeTabGroupWithId, ChromeTabId, LocalStorage } from "../../types";
import * as Utils from "../../utils";

export async function onStartUp() {
  try {
    const prevActiveWindows = await Utils.DataModel.ActiveWindow.getAll();
    const windows = Utils.Misc.getWindowsWithIds(await chrome.windows.getAll());
    const spaceAutoCollapseTimersToStart: { activeWindowId: string; spaceId: string }[] = [];
    const matchedWindowsToPrevActiveWindows = await Utils.WindowMatcher.matchWindowsToActiveWindows(
      windows,
      prevActiveWindows
    );

    const newActiveWindows = matchedWindowsToPrevActiveWindows.map(
      (matchedWindowToPrevActiveWindowInfo) => {
        const { windowInfo, candidateMatchedWindowInfo } = matchedWindowToPrevActiveWindowInfo;
        const {
          activeWindow: prevActiveWindow,
          matchedMiscTabGroupToSpace,
          matchedNonMiscTabGroupsToSpaces,
        } = candidateMatchedWindowInfo;

        // group any non-grouped tabs in the window
        // let nonGroupedTabsNewGroup: ChromeTabGroupWithId | undefined;
        // const nonGroupedTabs = windowInfo.tabs.filter(
        //   (tab) => tab.groupId === chrome.tabGroups.TAB_GROUP_ID_NONE
        // );
        // if (nonGroupedTabs.length > 0) {
        //   const tabGroupId = await chrome.tabs.group({
        //     createProperties: {
        //       windowId: windowInfo.window.id,
        //     },
        //     tabIds: nonGroupedTabs.map((tab) => tab.id),
        //   });
        //   nonGroupedTabsNewGroup = await chrome.tabGroups.get(tabGroupId);
        // }

        let newActiveWindowSpaces: TidyTabs.ActiveSpace[];
        let newActiveWindowSelectedSpaceId: string | undefined;
        let newActiveWindowPrimarySpaceId: string | undefined;
        let newActiveWindowSelectedTabFocusType:
          | TidyTabs.ActiveWindow["selectedSpaceFocusType"]
          | undefined;
        let newActiveWindowSelectedTabId: ChromeTabId | undefined;
        let newActiveWindowMiscTabGroup: ChromeTabGroupWithId | undefined;

        const selectedTab = windowInfo.tabs.find((tab) => tab.active)!;
        newActiveWindowSelectedTabId = selectedTab.id;
        const tabGroupIdForSelectedTab = selectedTab.groupId;

        if (tabGroupIdForSelectedTab === chrome.tabGroups.TAB_GROUP_ID_NONE) {
          newActiveWindowSelectedTabFocusType = "nonSpaceTabFocus";
        }

        newActiveWindowSpaces = windowInfo.tabGroups.map((tabGroup) => {
          const matchedSpaceId = matchedNonMiscTabGroupsToSpaces.find(
            (matchedNonMiscTabGroupToSpaceInfo) =>
              matchedNonMiscTabGroupToSpaceInfo.tabGroupId === tabGroup.id
          )?.spaceId;

          const isTabGroupForSelectedTab = tabGroupIdForSelectedTab === tabGroup.id;
          const isTabGroupForPrimarySpace =
            matchedSpaceId && matchedSpaceId === prevActiveWindow.primarySpaceId;
          const isTabGroupForMiscSpace =
            matchedMiscTabGroupToSpace && tabGroup.id === matchedMiscTabGroupToSpace.tabGroupId;

          if (isTabGroupForSelectedTab) {
            if (isTabGroupForPrimarySpace) {
              newActiveWindowSelectedTabFocusType = "primaryFocus";
            } else if (isTabGroupForMiscSpace) {
              newActiveWindowSelectedTabFocusType = "secondaryFocus";
            } else {
              newActiveWindowSelectedTabFocusType = "peakFocus";
            }
          }

          const tabsInGroup = windowInfo.tabs.filter((tab) => tab.groupId === tabGroup.id);
          const newWindowActiveSpace = Utils.DataModel.ActiveWindowSpace.createFromExistingTabGroup(
            tabGroup,
            tabsInGroup
          );

          if (isTabGroupForSelectedTab) {
            newActiveWindowSelectedSpaceId = newWindowActiveSpace.id;
          }

          if (isTabGroupForPrimarySpace) {
            newActiveWindowPrimarySpaceId = newWindowActiveSpace.id;
          }

          if (isTabGroupForMiscSpace) {
            newActiveWindowMiscTabGroup = tabGroup;
          }

          return newWindowActiveSpace;
        });

        if (
          newActiveWindowSpaces.length === 0 ||
          !newActiveWindowSelectedSpaceId ||
          !newActiveWindowPrimarySpaceId ||
          !newActiveWindowSelectedTabFocusType ||
          !newActiveWindowSelectedTabId ||
          !newActiveWindowMiscTabGroup ||
          !newActiveWindowMiscTabGroup
        ) {
          const errorMessage = `initializeDataModel::Could not create active spaces for window ${windowInfo.window.id} from matched window ${prevActiveWindow.windowId}`;
          console.error(errorMessage);
          throw new Error(errorMessage);
        }

        const newActiveWindow = Utils.DataModel.ActiveWindow.create({
          windowId: windowInfo.window.id,
          spaces: newActiveWindowSpaces,
          selectedSpaceId: newActiveWindowSelectedSpaceId,
          primarySpaceId: newActiveWindowPrimarySpaceId,
          selectedSpaceFocusType: newActiveWindowSelectedTabFocusType,
          selectedTabId: newActiveWindowSelectedTabId,
          miscTabGroup: newActiveWindowMiscTabGroup,
        });

        if (
          newActiveWindowSelectedTabFocusType === "peakFocus" ||
          newActiveWindowSelectedTabFocusType === "secondaryFocus"
        ) {
          spaceAutoCollapseTimersToStart.push({
            activeWindowId: newActiveWindow.id,
            spaceId: newActiveWindowSelectedSpaceId,
          });
        }

        return newActiveWindow;
      }
    );

    const newDataModel = {
      ...Utils.Storage.LOCAL_STORAGE_DEFAULT_VALUES,
      activeWindows: newActiveWindows,
    } as LocalStorage;

    await Utils.Storage.setItems(newDataModel);

    spaceAutoCollapseTimersToStart.forEach(async (timerToStart) => {
      await Utils.DataModel.SpaceAutoCollapseTimer.startAutoCollapseTimerForSpace(
        timerToStart.activeWindowId,
        timerToStart.spaceId
      );
    });
  } catch (error) {
    const errorMessage = new Error(
      `DataModel::initialize:Could not intitialize data model: ${error}`
    );
    console.error(errorMessage);
    throw error;
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
  if (activeWindow.miscTabGroup.id === tabGroup.id) {
    // do #1.1
    await Utils.DataModel.ActiveWindow.update(activeWindow.id, {
      miscTabGroup: tabGroup,
    });

    // if #1.2
    if (Utils.Misc.tabGroupWasExpanded(tabGroup, activeWindow.miscTabGroup)) {
      // do #1.2.1
      const tabsInMiscGroup = Utils.Misc.getTabsWithIds(
        await chrome.tabs.query({
          windowId: activeWindow.windowId,
          groupId: tabGroup.id,
        })
      );
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
      const tabsInSelectedActiveSpaceTabGroup = Utils.Misc.getTabsWithIds(
        await chrome.tabs.query({
          windowId: activeWindow.windowId,
          groupId: selectedActiveSpace.tabGroupInfo.id,
        })
      );
      const activeTabCandidate = tabsInSelectedActiveSpaceTabGroup[0];
      await chrome.tabs.update(activeTabCandidate.id, { active: true });
    }

    return;
  }

  const activeSpaceFindResult = await Utils.DataModel.findActiveSpaceForChromeObject<"tabGroup">(
    tabGroup.windowId,
    tabGroup
  );

  if (!activeSpaceFindResult) {
    return;
  }

  const { activeSpace, type: activeSpaceTabGroupType } = activeSpaceFindResult;

  await Utils.DataModel.syncActiveSpaceWithWindow({
    activeWindow,
    activeSpace,
    type: "tabGroup",
    data: tabGroup,
  });
}

function onSpaceNotInTidyTabsShape(space: TidyTabs.Space) {
  // TODO: implement this
  console.log(`onSpaceNotInTidyTabsShape::space: ${space}`);
}
