import { DataModel } from "./model";
export { DataModel };

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
    activeSpace: DataModel.ActiveSpace;
    type: FindResultType<FindType>;
  }
}

export declare namespace ActiveWindowMatcher {
  export interface BaseMatchedTabGroupToActiveWindowSpaceInfo {
    tabGroupId: ChromeTabGroupId;
    tabGroupColorsMatch: boolean;
  }

  export interface MatchedMiscTabGroupToActiveWindowSpaceInfo
    extends BaseMatchedTabGroupToActiveWindowSpaceInfo {
    primarySpaceId: string;
  }

  export interface MatchedNonMiscTabGroupToActiveWindowSpaceInfo
    extends BaseMatchedTabGroupToActiveWindowSpaceInfo {
    spaceId: string;
    matchedTabsCount: number;
  }

  export interface MatchedWindowToActiveWindowInfo {
    windowId: ChromeWindowId;
    activeWindow: DataModel.ActiveWindow;
    matchedMiscTabGroupInfo: MatchedMiscTabGroupToActiveWindowSpaceInfo | undefined;
    matchedNonMiscTabGroups: MatchedNonMiscTabGroupToActiveWindowSpaceInfo[];
    matchedTabsCount: number;
  }

  export type MatchedWindowToActiveWindowResultInfo = WindowInfo & MatchedWindowToActiveWindowInfo;

  export interface WindowInfo {
    window: ChromeWindowWithId;
    miscTabGroup: ChromeTabGroupWithId | undefined;
    nonMiscTabGroups: ChromeTabGroupWithId[];
    tabs: ChromeTabWithId[];
    tabGroups: ChromeTabGroupWithId[];
  }
}

export type SpaceSyncDataType = "tab" | "tabGroup";

export interface SpaceSyncData<T extends SpaceSyncDataType> {
  activeWindow: DataModel.ActiveWindow;
  activeSpace: DataModel.ActiveSpace;
  type: T;
  data: T extends "tab" ? ChromeTabWithId : ChromeTabGroupWithId;
}
