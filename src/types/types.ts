import { DBSchema } from "idb";

export interface ModelDataBase extends DBSchema {
  activeWindows: {
    value: ModelDataBaseActiveWindow;
    key: ModelDataBaseActiveWindow["windowId"];
  };
  activeTabGroups: {
    value: ModelDataBaseActiveTabGroup;
    key: ModelDataBaseActiveTabGroup["tabGroupId"];
    indexes: { windowId: ModelDataBaseActiveTabGroup["windowId"] };
  };
}

export type ModelDataBaseActiveWindow = ActiveWindow;

export interface ActiveWindow {
  windowId: ChromeWindowId;
  lastActiveTabInfo: LastActiveTabInfo;
}

export type ModelDataBaseActiveTabGroup = ActiveTabGroup;

export interface ActiveTabGroup {
  tabGroupId: ChromeTabGroupId;
  windowId: ChromeWindowId;
  lastActiveTabId: ChromeTabId | null;
}

export type ChromeId = number;
export type ChromeWindowId = ChromeId;
export type ChromeTabGroupId = ChromeId;
export type ChromeTabId = ChromeId;

export type ChromeWindowWithId = chrome.windows.Window & { id: ChromeWindowId };
export type ChromeTabGroupWithId = chrome.tabGroups.TabGroup & {
  id: ChromeTabGroupId;
};
export type ChromeTabWithId = chrome.tabs.Tab & { id: ChromeTabId };

export interface LocalStorageShape {
  userPreferences: UserPreferences;
}

export interface UserPreferences {
  repositionTabs: boolean;
  repositionTabGroups: boolean;
  addNewTabToFocusedTabGroup: boolean;
  collapseUnfocusedTabGroups: boolean;
  activateTabInFocusedTabGroup: boolean;
}

export interface LastActiveTabInfo {
  tabId: ChromeTabId;
  tabGroupId: ChromeTabGroupId;
  title: string | undefined;
}

export interface LastGroupedTabInfo {
  tabId: ChromeTabId;
  tabGroupId: ChromeTabGroupId;
}

export type YesOrNo = "yes" | "no";
export type YesOrNoOrNA = "yes" | "no" | "n/a";
