import { DBSchema } from "idb";

export interface ModelDataBase extends DBSchema {
  activeWindows: {
    value: ModelDataBaseActiveWindow;
    key: ModelDataBaseActiveWindow["windowId"];
  };
}

export interface ModelDataBaseActiveWindow {
  windowId: ActiveWindow["windowId"];
}

export interface ActiveWindow {
  windowId: ChromeWindowId;
}

export type ChromeId = number;
export type ChromeWindowId = ChromeId;
export type ChromeTabGroupId = ChromeId;
export type ChromeTabId = ChromeId;

export type ChromeWindowWithId = chrome.windows.Window & { id: ChromeWindowId };
export type ChromeTabGroupWithId = chrome.tabGroups.TabGroup & {
  id: ChromeTabGroupId;
};
export type ChromeTabWithId = chrome.tabs.Tab & {
  id: ChromeTabId;
  // FIXME: remove this when the chrome typings are updated to include the lastAccessed property
  lastAccessed?: number | undefined;
};

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

export interface LastGroupedTabInfo {
  tabId: ChromeTabId;
  tabGroupId: ChromeTabGroupId;
}

export type YesOrNo = "yes" | "no";
export type YesOrNoOrNA = "yes" | "no" | "n/a";
