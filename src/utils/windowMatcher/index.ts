import {
  ChromeWindowWithId,
  TidyTabs,
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
  activeWindows: TidyTabs.ActiveWindow[]
) {
  const candidateMatchedWindowsToActiveWindowsMap: {
    [activeWindowId: string]: ActiveWindowMatcher.CandidateWindowToActiveWindowMatchInfo[];
  } = {};
  const matchedWindowsInfoMap: { [windowId: string]: ActiveWindowMatcher.MatchedWindowInfo } = {};

  // get the match candidates
  await Promise.all(
    windows.map(async (window) => {
      // A matched window must:
      // 1. Be a "normal" window
      // 2. Contain at least one tab group
      // When matched against a previous active window, it must:
      // 3. Not contain more than one misc tab group.
      // 4. If the previous active window's primary space has more than one tab, then the misc tab must exist.
      // 5. Match all (non-misc) tab groups to that of one of the active spaces in the previous active window.
      //    This is done by matching their titles. If more than one tab group match the title of a space, then the one that matches the color
      //    of the space's tab group color is chosen. If that isnt enough, the one with the most matched tabs to the space is chosen.
      // If more than one window matches the same previous active window, the one with the most matched spaces and tabs is chosen.

      // criteria #1
      if (window.type !== "normal") {
        console.warn(`initializeDataModel::Window ${window.id} is not a normal window`);
        return;
      }

      let tabGroups = await chrome.tabGroups.query({
        windowId: window.id,
      });

      // criteria #2
      if (tabGroups.length === 0) {
        console.warn(`initializeDataModel::Window ${window.id} has no tab groups`);
        return;
      }

      const tabs = Utils.Misc.getTabsWithIds(await chrome.tabs.query({ windowId: window.id }));

      activeWindows.forEach((activeWindow) => {
        const { spaces, primarySpaceId } = activeWindow;
        const primarySpaceTabs = spaces.find((space) => space.id === primarySpaceId)!.tabs;

        let miscTabGroupTitleToMatch =
          activeWindow.selectedSpaceFocusType === "primaryFocus"
            ? Utils.Misc.MISC_TAB_GROUP_TITLE_LEFT
            : Utils.Misc.MISC_TAB_GROUP_TITLE_RIGHT;
        const matchedMiscTabGroups = tabGroups.filter(
          (tabGroup) => tabGroup.title === miscTabGroupTitleToMatch
        );

        // criteria #3
        if (matchedMiscTabGroups.length > 1) {
          console.warn(`initializeDataModel::Window ${window.id} has more than one misc tab group`);
          return;
        }

        // criteria #4
        if (primarySpaceTabs.length > 1 && matchedMiscTabGroups.length === 0) {
          console.warn(
            `initializeDataModel::Window ${window.id} has no misc tab group when it must`
          );
          return;
        }

        // TODO: FIXME: the ts compiler is not implicitly recognizing that miscTabGroup is optional, so we need to explicitly cast it as such
        const miscTabGroup = matchedMiscTabGroups[0] as ChromeTabGroupWithId | undefined;
        const miscTabGroupTabs = miscTabGroup
          ? tabs.filter((tab) => tab.groupId === miscTabGroup.id)
          : [];
        const nonMiscTabGroups = miscTabGroup
          ? tabGroups.filter((tabGroup) => tabGroup.id !== miscTabGroup.id)
          : tabGroups;
        const nonMiscTabGroupsTabs = tabs.filter(
          (tab) => !miscTabGroupTabs.find((miscTab) => miscTab.id === tab.id)
        );

        const matchTabGroupsToActiveWindowSpacesResult = matchTabGroupsToActiveWindowSpaces(
          { id: window.id, tabGroups: nonMiscTabGroups, tabs: nonMiscTabGroupsTabs },
          activeWindow
        );

        // criteria #5
        if (matchTabGroupsToActiveWindowSpacesResult === null) {
          return;
        }

        if (!candidateMatchedWindowsToActiveWindowsMap[activeWindow.id]) {
          candidateMatchedWindowsToActiveWindowsMap[activeWindow.id] = [];
        }

        candidateMatchedWindowsToActiveWindowsMap[activeWindow.id].push({
          windowId: window.id,
          activeWindow,
          matchedMiscTabGroupToSpace: miscTabGroup && {
            tabGroupId: miscTabGroup.id,
            spaceId: primarySpaceId,
            tabGroupColorsMatch: miscTabGroup.color === activeWindow.miscTabGroup.color,
            matchedTabsCount: getMatchingTabs(tabs, primarySpaceTabs).length,
          },
          matchedNonMiscTabGroupsToSpaces: matchTabGroupsToActiveWindowSpacesResult,
          matchedTabsCount: matchTabGroupsToActiveWindowSpacesResult.reduce(
            (acc, match) => acc + match.matchedTabsCount,
            0
          ),
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
  const matchedWindowsToActiveWindows: ActiveWindowMatcher.WindowToActiveWindowMatchInfo[] = [];
  let remainingWindowIdsToMatch = Array.from(Object.keys(matchedWindowsInfoMap)).map(Number);
  for (let activeWindowId in candidateMatchedWindowsToActiveWindowsMap) {
    const candidateMatchedWindows = candidateMatchedWindowsToActiveWindowsMap[activeWindowId];
    let bestMatchedWindow: ActiveWindowMatcher.WindowToActiveWindowMatchInfo | undefined;
    let bestMatchedTabsCount = 0;
    candidateMatchedWindows.forEach((candidateMatchedWindowInfo) => {
      if (
        remainingWindowIdsToMatch.includes(candidateMatchedWindowInfo.windowId) &&
        candidateMatchedWindowInfo.matchedTabsCount >= bestMatchedTabsCount
      ) {
        bestMatchedWindow = {
          windowInfo: matchedWindowsInfoMap[candidateMatchedWindowInfo.windowId],
          candidateMatchedWindowInfo,
        };
        bestMatchedTabsCount = candidateMatchedWindowInfo.matchedTabsCount;
      }
    });

    if (bestMatchedWindow) {
      matchedWindowsToActiveWindows.push(bestMatchedWindow);
      remainingWindowIdsToMatch = remainingWindowIdsToMatch.filter(
        (windowId) => windowId !== bestMatchedWindow!.windowInfo.window.id
      );
    }
  }

  return matchedWindowsToActiveWindows;
}

export function matchTabGroupsToActiveWindowSpaces(
  windowInfo: {
    id: ChromeWindowId;
    tabGroups: ChromeTabGroupWithId[];
    tabs: ChromeTabWithId[];
  },
  activeWindow: TidyTabs.ActiveWindow
) {
  // get the match candidates
  const candidateMatchedTabGroupsToSpacesMap: {
    [spaceId: string]: ActiveWindowMatcher.TabGroupToActiveWindowSpaceMatchInfo[];
  } = {};

  const { tabGroups, tabs } = windowInfo;
  const tabsByTabGroupId: { [tabGroupId: ChromeTabGroupId]: ChromeTabWithId[] } = {};
  const tabGroupsToMatchIds = new Set<ChromeTabGroupId>();

  for (let space of activeWindow.spaces) {
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

    // if no tab groups match this space, then the window is not a match
    if (candidateMatchedTabGroupsToSpacesMap[space.id].length === 0) {
      return null;
    }
  }

  const matchedTabGroupsToSpaces: ActiveWindowMatcher.TabGroupToActiveWindowSpaceMatchInfo[] = [];
  let remainingTabGroupsToMatchIds = Array.from(tabGroupsToMatchIds);

  // get the best matches for each space
  for (let spaceId in candidateMatchedTabGroupsToSpacesMap) {
    let bestMatchedTabGroup: ActiveWindowMatcher.TabGroupToActiveWindowSpaceMatchInfo | undefined;
    let bestMatchedTabsCount = 0;

    const candidateMatchedTabGroupsToSpaces = candidateMatchedTabGroupsToSpacesMap[spaceId];

    candidateMatchedTabGroupsToSpaces.forEach((candidateMatchedTabGroupToSpaceInfo) => {
      if (
        remainingTabGroupsToMatchIds.includes(candidateMatchedTabGroupToSpaceInfo.tabGroupId) &&
        candidateMatchedTabGroupToSpaceInfo.matchedTabsCount >= bestMatchedTabsCount
      ) {
        bestMatchedTabGroup = candidateMatchedTabGroupToSpaceInfo;
        bestMatchedTabsCount = candidateMatchedTabGroupToSpaceInfo.matchedTabsCount;
      }
    });

    // if this space has no match, then the window is not a match
    if (!bestMatchedTabGroup) {
      return null;
    }

    remainingTabGroupsToMatchIds = remainingTabGroupsToMatchIds.filter(
      (tabGroupId) => tabGroupId !== bestMatchedTabGroup!.tabGroupId
    );
    matchedTabGroupsToSpaces.push(bestMatchedTabGroup);
  }

  return matchedTabGroupsToSpaces;
}

export function getMatchingTabs(tabGroupTabs: ChromeTabWithId[], spaceTabs: TidyTabs.ActiveTab[]) {
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
