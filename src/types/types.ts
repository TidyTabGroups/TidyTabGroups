import { DBSchema } from "idb";

export interface ModelDataBase extends DBSchema {
  activeWindows: {
    value: ActiveWindow;
    key: ChromeWindowId;
  };
  activeTabGroups: {
    value: ActiveTabGroup;
    key: ChromeTabGroupId;
  };
  activeTabGroupAutoCollapseTimers: {
    value: ActiveTabGroupAutoCollapseTimer;
    key: string;
    indexes: { windowId: ActiveTabGroupAutoCollapseTimer["windowId"]; tabGroupId: ActiveTabGroupAutoCollapseTimer["tabGroupId"] };
  };
}

export interface ActiveWindow {
  windowId: ChromeWindowId;
}

export type ActiveTabGroup = chrome.tabGroups.TabGroup;

export interface ActiveTabGroupAutoCollapseTimer {
  id: string;
  tabGroupId: ChromeTabGroupId;
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
export type ChromeTabWithId = chrome.tabs.Tab & { id: ChromeTabId };

export interface LocalStorageShape {}
