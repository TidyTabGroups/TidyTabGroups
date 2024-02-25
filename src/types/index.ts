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

export declare namespace ActiveWindowMatcher {
  export interface MatchedTabGroupToActiveWindowSpaceInfo {
    tabGroupId: ChromeTabGroupId;
    tabGroupColorsMatch: boolean;
    activeSpaceId: string;
    matchedTabsCount: number;
  }

  export interface MatchedWindowToActiveWindowInfo {
    windowId: ChromeWindowId;
    activeWindow: DataModel.ActiveWindow;
    matchedTabGroups: MatchedTabGroupToActiveWindowSpaceInfo[];
    matchedTabsCount: number;
  }

  export type MatchedWindowToActiveWindowResultInfo = WindowInfo & MatchedWindowToActiveWindowInfo;

  export interface WindowInfo {
    window: ChromeWindowWithId;
    tabs: ChromeTabWithId[];
    tabGroups: ChromeTabGroupWithId[];
  }
}

export type SpaceSyncDataType = "tab" | "tabGroup";

export interface SpaceSyncData<T extends SpaceSyncDataType> {
  activeSpaceId: string;
  type: T;
  data: T extends "tab" ? ChromeTabWithId : ChromeTabGroupWithId;
}

export interface LocalStorageShape {}
