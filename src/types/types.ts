import { DBSchema } from "idb";

export interface ModelDataBase extends DBSchema {
  activeWindows: {
    value: ModelDataBaseActiveWindow;
    key: ModelDataBaseActiveWindow["windowId"];
  };
}

export interface ModelDataBaseActiveWindow {
  windowId: ActiveWindow["windowId"];
  focusMode: ActiveWindow["focusMode"];
  tabGroups: ActiveWindow["tabGroups"];
}

export interface ActiveWindow {
  windowId: ChromeWindowId;
  focusMode: ActiveWindowFocusMode | null;
  tabGroups: ActiveWindowTabGroup[];
}

export interface ActiveWindowFocusMode {
  colors: ActiveWindowFocusModeColors;
  savedTabGroupColors: Array<{ tabGroupId: ChromeTabGroupId; color: chrome.tabGroups.ColorEnum }>;
}

export interface ActiveWindowFocusModeColors {
  focused: chrome.tabGroups.ColorEnum;
  nonFocused: chrome.tabGroups.ColorEnum;
}

export interface ActiveWindowTabGroup {
  id: chrome.tabGroups.TabGroup["id"];
  title?: chrome.tabGroups.TabGroup["title"];
  color: chrome.tabGroups.TabGroup["color"];
  collapsed: chrome.tabGroups.TabGroup["collapsed"];
  windowId: ChromeWindowId;
  useTabTitle: boolean;
}

export type ChromeId = number;
export type ChromeWindowId = ChromeId;
export type ChromeTabGroupId = ChromeId;
export type ChromeTabId = ChromeId;

export type ChromeWindowWithId = chrome.windows.Window & { id: ChromeWindowId };
export type ChromeTabGroupWithId = chrome.tabGroups.TabGroup & {
  id: ChromeTabGroupId;
  color: ChromeTabGroupColorEnum;
};
export type ChromeTabWithId = chrome.tabs.Tab & {
  id: ChromeTabId;
  // FIXME: remove this when the chrome typings are updated to include the lastAccessed property
  lastAccessed?: number | undefined;
};

// FIXME: remove these when the chrome.tabGroups.ColorEnum is updated to include the orange color
export type ChromeTabGroupColorEnum = chrome.tabGroups.ColorEnum | "orange";
export type ChromeTabGroupUpdateProperties = chrome.tabGroups.UpdateProperties & {
  color?: ChromeTabGroupColorEnum | undefined;
};

export interface LocalStorageShape {
  userPreferences: UserPreferences;
  lastSeenFocusModeColors: ActiveWindowFocusModeColors;
  lastFocusedWindowHadFocusMode: boolean;
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
