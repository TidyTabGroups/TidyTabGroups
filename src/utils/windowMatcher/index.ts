import {
  ChromeWindowWithId,
  DataModel,
  ActiveWindowMatcher,
  ChromeTabGroupWithId,
  ChromeTabGroupId,
  ChromeTabId,
  ChromeTabWithId,
  ChromeWindowId,
} from "../../types";
import * as Utils from "../../utils";

export async function matchWindowsToActiveWindows(
  windows: ChromeWindowWithId[],
  activeWindows: DataModel.ActiveWindow[]
) {
  const candidateMatchedWindowsToActiveWindowsMap: {
    [activeWindowId: string]: ActiveWindowMatcher.MatchedWindowToActiveWindowInfo[];
  } = {};
  const matchedWindowsInfoMap: { [windowId: string]: ActiveWindowMatcher.WindowInfo } = {};

  // get the match candidates
  // Note: If more than one window matches the same previous active window, the one with the most matched spaces and tabs is chosen.
  await Promise.all(
    windows.map(async (window) => {
      // A matched window must:
      // 1. Be a "normal" window
      // 2. contain at least one tab
      // When matched against a previous active window, it must:
      // 3. if the active window has a primary space with more than one tab, then the misc tab group must exist.
      // 4. If the active window has any spaces, they all must match to a (non-misc) tab group.
      //    This is done by matching their titles. If more than one tab group match the title of a space, then the one that matches the color
      //    of the space's tab group color is chosen. If that isnt enough, the one with the most matched tabs to the space is chosen.
      // 5. If the active window has any non-grouped tabs, they all must match to a tab.

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
        const {
          spaces,
          primarySpaceId,
          selectedSpaceFocusType,
          nonGroupedTabs: activeWindowNonGroupedTabs,
        } = activeWindow;

        const primarySpaceTabs = primarySpaceId
          ? spaces.find((space) => space.id === primarySpaceId)!.tabs
          : undefined;
        let miscTabGroup: ChromeTabGroupWithId | undefined;
        if (primarySpaceId && primarySpaceTabs!.length > 1) {
          const miscTabGroupTitleToMatch =
            selectedSpaceFocusType === "primaryFocus"
              ? Utils.Misc.MISC_TAB_GROUP_TITLE_LEFT
              : Utils.Misc.MISC_TAB_GROUP_TITLE_RIGHT;
          const matchedMiscTabGroups = tabGroups.filter(
            (tabGroup) => tabGroup.title === miscTabGroupTitleToMatch
          );

          let bestMatchedMiscTabGroup: ChromeTabGroupWithId | undefined;
          if (matchedMiscTabGroups.length > 1) {
            // find the best matching misc tab group
            matchedMiscTabGroups.forEach((matchedMiscTabGroup) => {
              const tabsInMatchedMiscTabGroup = tabs.filter(
                (tab) => tab.groupId === matchedMiscTabGroup.id
              );
            });
          } else {
            bestMatchedMiscTabGroup = matchedMiscTabGroups[0];
          }

          // criteria #3
          if (!bestMatchedMiscTabGroup) {
            console.warn(
              `initializeDataModel::Window ${window.id} has no misc tab group when it must`
            );
            return;
          }

          miscTabGroup = bestMatchedMiscTabGroup;
        }

        const nonMiscTabGroups = miscTabGroup
          ? tabGroups.filter((tabGroup) => tabGroup.id !== miscTabGroup!.id)
          : tabGroups;
        let matchedNonMiscTabGroupsToActiveWindowSpaces:
          | ActiveWindowMatcher.MatchedNonMiscTabGroupToActiveWindowSpaceInfo[]
          | undefined;

        if (spaces.length > 0) {
          const miscTabGroupTabs = miscTabGroup
            ? tabs.filter((tab) => tab.groupId === miscTabGroup!.id)
            : [];
          const nonMiscTabGroupsTabs = tabs.filter(
            (tab) => !miscTabGroupTabs.find((miscTab) => miscTab.id === tab.id)
          );

          const matchedNonMiscTabGroupsToActiveWindowSpaces = getMatchingTabGroups(
            { id: window.id, tabGroups: nonMiscTabGroups, tabs: nonMiscTabGroupsTabs },
            activeWindow
          );

          // criteria #4
          if (matchedNonMiscTabGroupsToActiveWindowSpaces.length !== spaces.length) {
            return;
          }
        }

        const nonGroupedTabs = tabs.filter(
          (tab) => tab.groupId === chrome.tabGroups.TAB_GROUP_ID_NONE
        );
        const matchedNonGroupedTabs = getMatchingTabs(nonGroupedTabs, activeWindow.nonGroupedTabs);
        // criteria #5
        if (matchedNonGroupedTabs.length < activeWindowNonGroupedTabs.length) {
          return;
        }

        if (!candidateMatchedWindowsToActiveWindowsMap[activeWindow.id]) {
          candidateMatchedWindowsToActiveWindowsMap[activeWindow.id] = [];
        }
        candidateMatchedWindowsToActiveWindowsMap[activeWindow.id].push({
          windowId: window.id,
          activeWindow,
          matchedMiscTabGroupInfo: miscTabGroup && {
            primarySpaceId: primarySpaceId!,
            tabGroupId: miscTabGroup.id,
            tabGroupColorsMatch: miscTabGroup.color === activeWindow.miscTabGroup!.color,
          },
          matchedNonMiscTabGroups: matchedNonMiscTabGroupsToActiveWindowSpaces
            ? matchedNonMiscTabGroupsToActiveWindowSpaces
            : [],
          matchedTabsCount: matchedNonMiscTabGroupsToActiveWindowSpaces
            ? matchedNonMiscTabGroupsToActiveWindowSpaces.reduce(
                (acc, match) => acc + match.matchedTabsCount,
                0
              ) + matchedNonGroupedTabs.length
            : matchedNonGroupedTabs.length,
        });

        // store the matched window info for later use
        if (!matchedWindowsInfoMap[window.id]) {
          matchedWindowsInfoMap[window.id] = {
            window,
            miscTabGroup,
            nonMiscTabGroups,
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
      remainingWindowIdsToMatch = remainingWindowIdsToMatch.filter(
        (windowId) => windowId !== bestMatchedWindow!.windowId
      );
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
  activeWindow: DataModel.ActiveWindow
) {
  // get the match candidates
  const candidateMatchedTabGroupsToSpacesMap: {
    [spaceId: string]: ActiveWindowMatcher.MatchedNonMiscTabGroupToActiveWindowSpaceInfo[];
  } = {};

  const { tabGroups, tabs } = windowInfo;
  const tabsByTabGroupId: { [tabGroupId: ChromeTabGroupId]: ChromeTabWithId[] } = {};
  const tabGroupsToMatchIds = new Set<ChromeTabGroupId>();

  activeWindow.spaces.forEach((space) => {
    candidateMatchedTabGroupsToSpacesMap[space.id] = [];
    for (let tabGroup of tabGroups) {
      if (!tabsByTabGroupId[tabGroup.id]) {
        tabsByTabGroupId[tabGroup.id] = tabs.filter((tab) => tab.groupId === tabGroup.id);
      }

      if (tabGroup.title == space.tabGroupInfo.title) {
        tabGroupsToMatchIds.add(tabGroup.id);
        candidateMatchedTabGroupsToSpacesMap[space.id].push({
          tabGroupId: tabGroup.id,
          spaceId: space.id,
          tabGroupColorsMatch: tabGroup.color === space.tabGroupInfo.color,
          matchedTabsCount: getMatchingTabs(tabsByTabGroupId[tabGroup.id], space.tabs).length,
        });
      }
    }

    if (candidateMatchedTabGroupsToSpacesMap[space.id].length === 0) {
      return;
    }
  });

  const matchedTabGroupsToSpaces: ActiveWindowMatcher.MatchedNonMiscTabGroupToActiveWindowSpaceInfo[] =
    [];
  let remainingTabGroupsToMatchIds = Array.from(tabGroupsToMatchIds);

  // get the best matches for each space
  Object.keys(candidateMatchedTabGroupsToSpacesMap).forEach((spaceId) => {
    let bestMatchedTabGroupInfo:
      | ActiveWindowMatcher.MatchedNonMiscTabGroupToActiveWindowSpaceInfo
      | undefined;
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

    remainingTabGroupsToMatchIds = remainingTabGroupsToMatchIds.filter(
      (tabGroupId) => tabGroupId !== bestMatchedTabGroupInfo!.tabGroupId
    );
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
      if (
        tabGroupTab.title === spaceTab.tabInfo.title &&
        tabGroupTab.url === spaceTab.tabInfo.url
      ) {
        matchedTabGroupTabsToSpaceTabs.push({
          tabGroupTabId: tabGroupTab.id,
          spaceTabId: spaceTab.id,
        });
        remainingSpaceTabsToMatch = remainingSpaceTabsToMatch.filter(
          (remaingSpaceTab) => remaingSpaceTab.id !== spaceTab.id
        );
        break;
      }
    }
  });

  return matchedTabGroupTabsToSpaceTabs;
}
