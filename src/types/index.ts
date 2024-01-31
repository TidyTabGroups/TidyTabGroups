export type ChromeId = number;
export type ChromeWindowId = ChromeId;
export type ChromeTabGroupId = ChromeId;
export type ChromeTabId = ChromeId;

export type ChromeWindowWithId = chrome.windows.Window & { id: ChromeWindowId };
export type ChromeTabGroupWithId = chrome.tabGroups.TabGroup & {
  id: ChromeTabGroupId;
};
export type ChromeTabWithId = chrome.tabs.Tab & { id: ChromeTabId };

export interface TabGroupCreationOptions {
  windowId?: ChromeWindowId;
  title?: string;
  color?: chrome.tabGroups.ColorEnum;
}

export declare namespace TidyTabs {
  export interface TabCreateProperties {
    id?: string;
  }

  export interface ActiveTabCreateProperties extends TabCreateProperties {
    tabInfo: {
      id: ChromeTabId;
      url?: string;
      title?: string;
    };
  }

  export interface BaseTab {
    id: string;
  }

  export type Tab = BaseTab & TabCreateProperties;
  export type ActiveTab = BaseTab & ActiveTabCreateProperties;

  export interface SpaceCreateProperties {
    id?: string;
    tabs: Tab[];
  }

  export interface ActiveSpaceCreateProperties extends SpaceCreateProperties {
    windowId: ChromeWindowId;
    tabGroupInfo: {
      id: ChromeTabGroupId;
      title?: string;
      color?: chrome.tabGroups.ColorEnum;
    };
    tabs: ActiveTab[];
  }

  export interface BaseSpace {
    id: string;
  }

  export type Space = BaseSpace & SpaceCreateProperties;
  export type ActiveSpace = BaseSpace & ActiveSpaceCreateProperties;

  export interface BaseWindow {
    id: string;
  }

  export interface ActiveWindowCreateProperties {
    id?: string;
    windowId: ChromeWindowId;
    spaces: ActiveSpace[]; // in order of how they appear in the tab bar
    selectedSpaceId: string;
    primarySpaceId: string;
    /*
      primaryFocus: the primary tab group is selected
      secondaryFocus: the secondary tab group is selected
      peakFocus: the selected space is being "peaked"
      nonSpaceTabFocus: a tab that doesnt belong to any space is selected
     */
    selectedSpaceFocusType: "primaryFocus" | "secondaryFocus" | "peakFocus" | "nonSpaceTabFocus";
    selectedTabId: ChromeTabId;
    miscTabGroup: ChromeTabGroupWithId;
  }

  export type ActiveWindow = BaseWindow & ActiveWindowCreateProperties;

  export interface SpaceAutoCollapseTimer {
    id: string;
    activeWindowId: string;
    spaceId: string;
    time: number;
  }

  export type SpaceSyncDataType = "tab" | "tabGroup";

  export interface SpaceSyncData<T extends SpaceSyncDataType> {
    activeWindow: ActiveWindow;
    activeSpace: ActiveSpace;
    type: T;
    data: T extends "tab" ? ChromeTabWithId : ChromeTabGroupWithId;
  }
}

export interface LocalStorage {
  activeWindows: TidyTabs.ActiveWindow[];
  spaceAutoCollapseTimers: TidyTabs.SpaceAutoCollapseTimer[];
}

export declare namespace ActiveSpaceForChromeObjectFinder {
  export type FindType = "tab" | "tabGroup" | "window";

  export type FindTabResultType = "activeTab" | "primaryTab" | "secondaryTab";
  export type FindTabGroupResultType = "primaryTabGroup" | "secondaryTabGroup";
  export type FindWindowResultType = "window";

  export type FindResultType<FindType> = FindType extends "tab"
    ? FindTabResultType
    : FindType extends "tabGroup"
    ? FindTabGroupResultType
    : FindWindowResultType;

  export type FindChromeObjectType<FindType> = FindType extends "tab"
    ? ChromeTabWithId
    : FindType extends "tabGroup"
    ? ChromeTabGroupWithId
    : ChromeWindowWithId;

  export interface FindResult<FindType> {
    activeSpace: TidyTabs.ActiveSpace;
    type: FindResultType<FindType>;
  }
}

export declare namespace ActiveWindowMatcher {
  export interface CandidateWindowToActiveWindowMatchInfo {
    windowId: ChromeWindowId;
    activeWindow: TidyTabs.ActiveWindow;
    matchedMiscTabGroupToSpace: TabGroupToActiveWindowSpaceMatchInfo | undefined;
    matchedNonMiscTabGroupsToSpaces: TabGroupToActiveWindowSpaceMatchInfo[];
    matchedTabsCount: number;
  }

  export interface WindowToActiveWindowMatchInfo {
    windowInfo: MatchedWindowInfo;
    candidateMatchedWindowInfo: CandidateWindowToActiveWindowMatchInfo;
  }

  export interface MatchedWindowInfo {
    window: ChromeWindowWithId;
    miscTabGroup: ChromeTabGroupWithId | undefined;
    nonMiscTabGroups: ChromeTabGroupWithId[];
    tabs: ChromeTabWithId[];
    tabGroups: ChromeTabGroupWithId[];
  }

  export interface TabGroupToActiveWindowSpaceMatchInfo {
    tabGroupId: ChromeTabGroupId;
    spaceId: string;
    tabGroupColorsMatch: boolean;
    matchedTabsCount: number;
  }
}
