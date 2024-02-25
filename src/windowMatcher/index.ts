import {
  ChromeWindowWithId,
  DataModel,
  ActiveWindowMatcher,
  ChromeTabGroupWithId,
  ChromeTabGroupId,
  ChromeTabId,
  ChromeTabWithId,
  ChromeWindowId,
} from "../types";
import { ActiveWindow } from "../model";

export async function matchWindowsToActiveWindows(windows: ChromeWindowWithId[], activeWindows: DataModel.ActiveWindow[]) {
  const candidateMatchedWindowsToActiveWindowsMap: {
    [activeWindowId: string]: ActiveWindowMatcher.MatchedWindowToActiveWindowInfo[];
  } = {};
  const matchedWindowsInfoMap: { [windowId: string]: ActiveWindowMatcher.WindowInfo } = {};

  // get the active spaces for each active window
  const { activeSpacesByActiveWindowId, activeTabsByActiveSpaceId, activeNonGroupedActiveTabsByWindowId } = await ActiveWindow.getActiveSpacesAndTabs(
    activeWindows.map((activeWindow) => activeWindow.id)
  );

  // get the match candidates
  // Note: If more than one window matches the same previous active window, the one with the most matched spaces and tabs is chosen.
  await Promise.all(
    windows.map(async (window) => {
      // A matched window must:
      // 1. Be a "normal" window
      // 2. contain at least one tab
      // When matched against a previous active window, it must:
      // 3. if the active window has any spaces, they all must match to a tab group in the window
      // 4. If the active window has any non-grouped tabs, they all must match to a tab in the window

      // criteria #1
      if (window.type !== "normal") {
        console.warn(`initializeDataModel::Window ${window.id} is not a normal window`);
        return;
      }

      const tabs = (await chrome.tabs.query({ windowId: window.id })) as ChromeTabWithId[];
      // criteria #2
      if (tabs.length === 0) {
        console.warn(`initializeDataModel::Window ${window.id} has no tabs`);
        return;
      }

      const tabGroups = await chrome.tabGroups.query({
        windowId: window.id,
      });

      activeWindows.forEach((activeWindow) => {
        const { primarySpaceId, selectedSpaceFocusType } = activeWindow;
        const activeSpaces = activeSpacesByActiveWindowId[activeWindow.id];
        const nonGroupedActiveTabs = activeNonGroupedActiveTabsByWindowId[activeWindow.id];
        let matchedTabGroupsToActiveWindowSpaces: ActiveWindowMatcher.MatchedTabGroupToActiveWindowSpaceInfo[] | undefined;

        if (activeSpaces.length > 0) {
          const groupedTabs = tabs.filter((tab) => tab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE);
          const matchedTabGroupsToActiveWindowSpaces = getMatchingTabGroups(
            { id: window.id, tabGroups: tabGroups, tabs: groupedTabs },
            {
              activeWindow,
              activeSpaces: activeSpaces.map((activeSpace) => ({ activeSpace, activeTabs: activeTabsByActiveSpaceId[activeSpace.id] })),
            }
          );

          // criteria #4
          if (matchedTabGroupsToActiveWindowSpaces.length !== activeSpaces.length) {
            return;
          }
        }

        const nonGroupedTabs = tabs.filter((tab) => tab.groupId === chrome.tabGroups.TAB_GROUP_ID_NONE);
        const matchedNonGroupedTabs = getMatchingTabs(nonGroupedTabs, nonGroupedActiveTabs);
        // criteria #5
        if (matchedNonGroupedTabs.length < nonGroupedActiveTabs.length) {
          return;
        }

        if (!candidateMatchedWindowsToActiveWindowsMap[activeWindow.id]) {
          candidateMatchedWindowsToActiveWindowsMap[activeWindow.id] = [];
        }
        candidateMatchedWindowsToActiveWindowsMap[activeWindow.id].push({
          windowId: window.id,
          activeWindow,
          matchedTabGroups: matchedTabGroupsToActiveWindowSpaces ? matchedTabGroupsToActiveWindowSpaces : [],
          matchedTabsCount: matchedTabGroupsToActiveWindowSpaces
            ? matchedTabGroupsToActiveWindowSpaces.reduce((acc, match) => acc + match.matchedTabsCount, 0) + matchedNonGroupedTabs.length
            : matchedNonGroupedTabs.length,
        });

        // store the matched window info for later use
        if (!matchedWindowsInfoMap[window.id]) {
          matchedWindowsInfoMap[window.id] = {
            window,
            tabs,
            tabGroups,
          };
        }
      });
    })
  );

  // get the best match for each previous active window
  const matchedWindowsToActiveWindows: ActiveWindowMatcher.MatchedWindowToActiveWindowInfo[] = [];
  let remainingWindowIdsToMatch = Array.from(Object.keys(matchedWindowsInfoMap)).map(Number);
  for (let activeWindowId in candidateMatchedWindowsToActiveWindowsMap) {
    const candidateMatchedWindows = candidateMatchedWindowsToActiveWindowsMap[activeWindowId];
    let bestMatchedWindow: ActiveWindowMatcher.MatchedWindowToActiveWindowResultInfo | undefined;
    let bestMatchedTabsCount = 0;
    candidateMatchedWindows.forEach((candidateMatchedWindowInfo) => {
      if (
        remainingWindowIdsToMatch.includes(candidateMatchedWindowInfo.windowId) &&
        candidateMatchedWindowInfo.matchedTabsCount >= bestMatchedTabsCount
      ) {
        bestMatchedWindow = {
          ...matchedWindowsInfoMap[candidateMatchedWindowInfo.windowId],
          ...candidateMatchedWindowInfo,
        };
        bestMatchedTabsCount = candidateMatchedWindowInfo.matchedTabsCount;
      }
    });

    if (bestMatchedWindow) {
      matchedWindowsToActiveWindows.push(bestMatchedWindow);
      remainingWindowIdsToMatch = remainingWindowIdsToMatch.filter((windowId) => windowId !== bestMatchedWindow!.windowId);
    }
  }

  return matchedWindowsToActiveWindows;
}

export function getMatchingTabGroups(
  windowInfo: {
    id: ChromeWindowId;
    tabGroups: ChromeTabGroupWithId[];
    tabs: ChromeTabWithId[];
  },
  activeWindowInfo: {
    activeWindow: DataModel.ActiveWindow;
    activeSpaces: {
      activeSpace: DataModel.ActiveSpace;
      activeTabs: DataModel.ActiveTab[];
    }[];
  }
) {
  // get the match candidates
  const candidateMatchedTabGroupsToSpacesMap: {
    [spaceId: string]: ActiveWindowMatcher.MatchedTabGroupToActiveWindowSpaceInfo[];
  } = {};

  const { tabGroups, tabs } = windowInfo;
  const tabsByTabGroupId: { [tabGroupId: ChromeTabGroupId]: ChromeTabWithId[] } = {};
  const tabGroupsToMatchIds = new Set<ChromeTabGroupId>();

  const { activeSpaces } = activeWindowInfo;

  activeSpaces.forEach((activeSpaceInfo) => {
    const { activeSpace, activeTabs } = activeSpaceInfo;
    candidateMatchedTabGroupsToSpacesMap[activeSpace.id] = [];
    for (let tabGroup of tabGroups) {
      if (!tabsByTabGroupId[tabGroup.id]) {
        tabsByTabGroupId[tabGroup.id] = tabs.filter((tab) => tab.groupId === tabGroup.id);
      }

      if (tabGroup.title == activeSpace.tabGroupInfo.title) {
        tabGroupsToMatchIds.add(tabGroup.id);
        candidateMatchedTabGroupsToSpacesMap[activeSpace.id].push({
          tabGroupId: tabGroup.id,
          activeSpaceId: activeSpace.id,
          tabGroupColorsMatch: tabGroup.color === activeSpace.tabGroupInfo.color,
          matchedTabsCount: getMatchingTabs(tabsByTabGroupId[tabGroup.id], activeSpaceInfo.activeTabs).length,
        });
      }
    }

    // FIXME: is this return needed?
    if (candidateMatchedTabGroupsToSpacesMap[activeSpace.id].length === 0) {
      return;
    }
  });

  const matchedTabGroupsToSpaces: ActiveWindowMatcher.MatchedTabGroupToActiveWindowSpaceInfo[] = [];
  let remainingTabGroupsToMatchIds = Array.from(tabGroupsToMatchIds);

  // get the best matches for each space
  Object.keys(candidateMatchedTabGroupsToSpacesMap).forEach((spaceId) => {
    let bestMatchedTabGroupInfo: ActiveWindowMatcher.MatchedTabGroupToActiveWindowSpaceInfo | undefined;
    let bestMatchedTabsCount = 0;

    const candidateMatchedTabGroupsToSpaces = candidateMatchedTabGroupsToSpacesMap[spaceId];

    candidateMatchedTabGroupsToSpaces.forEach((candidateMatchedTabGroupToSpaceInfo) => {
      if (
        remainingTabGroupsToMatchIds.includes(candidateMatchedTabGroupToSpaceInfo.tabGroupId) &&
        candidateMatchedTabGroupToSpaceInfo.matchedTabsCount >= bestMatchedTabsCount
      ) {
        bestMatchedTabGroupInfo = candidateMatchedTabGroupToSpaceInfo;
        bestMatchedTabsCount = candidateMatchedTabGroupToSpaceInfo.matchedTabsCount;
      }
    });

    if (!bestMatchedTabGroupInfo) {
      return;
    }

    remainingTabGroupsToMatchIds = remainingTabGroupsToMatchIds.filter((tabGroupId) => tabGroupId !== bestMatchedTabGroupInfo!.tabGroupId);
    matchedTabGroupsToSpaces.push(bestMatchedTabGroupInfo);
  });

  return matchedTabGroupsToSpaces;
}

export function getMatchingTabs(tabGroupTabs: ChromeTabWithId[], spaceTabs: DataModel.ActiveTab[]) {
  interface MatchedTabGroupTabToSpaceTabInfo {
    tabGroupTabId: ChromeTabId;
    spaceTabId: string;
  }

  let remainingSpaceTabsToMatch = spaceTabs;
  let matchedTabGroupTabsToSpaceTabs: MatchedTabGroupTabToSpaceTabInfo[] = [];

  tabGroupTabs.forEach((tabGroupTab) => {
    for (let spaceTab of remainingSpaceTabsToMatch) {
      if (tabGroupTab.title === spaceTab.tabInfo.title && tabGroupTab.url === spaceTab.tabInfo.url) {
        matchedTabGroupTabsToSpaceTabs.push({
          tabGroupTabId: tabGroupTab.id,
          spaceTabId: spaceTab.id,
        });
        remainingSpaceTabsToMatch = remainingSpaceTabsToMatch.filter((remaingSpaceTab) => remaingSpaceTab.id !== spaceTab.id);
        break;
      }
    }
  });

  return matchedTabGroupTabsToSpaceTabs;
}
