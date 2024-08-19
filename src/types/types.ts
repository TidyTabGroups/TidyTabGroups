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
};
export type ChromeTabWithId = chrome.tabs.Tab & {
  id: ChromeTabId;
};

export type ChromeTabGroupChangeInfo = {
  collapsed?: boolean;
  title?: string;
  color?: chrome.tabGroups.ColorEnum;
};

export interface LocalStorageShape {
  userPreferences: UserPreferences;
  lastSeenFocusModeColors: ActiveWindowFocusModeColors;
  lastFocusedWindowHadFocusMode: boolean;
  lastError: string | null;
}

export interface UserPreferences {
  repositionTabs: boolean;
  repositionTabGroups: boolean;
  alwaysGroupTabs: boolean;
  collapseUnfocusedTabGroups: boolean;
  activateTabInFocusedTabGroup: boolean;
}

export interface LastGroupedTabInfo {
  tabId: ChromeTabId;
  tabGroupId: ChromeTabGroupId;
}

export type YesOrNo = "yes" | "no";
export type YesOrNoOrNA = "yes" | "no" | "n/a";

export type MouseInPageStatus = "entered" | "focused" | "left";
