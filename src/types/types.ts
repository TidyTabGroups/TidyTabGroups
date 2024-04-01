import { DBSchema } from "idb";

export interface ModelDataBase extends DBSchema {
  activeWindows: {
    value: ModelDataBaseActiveWindow;
    key: ModelDataBaseActiveWindow["windowId"];
  };
}

export interface ModelDataBaseActiveWindow {
  windowId: ActiveWindow["windowId"];
  lastActiveTabInfo: ActiveWindow["lastActiveTabInfo"];
  tabGroupHighlightColors: ActiveWindow["tabGroupHighlightColors"];
  tabGroups: ActiveWindow["tabGroups"];
}

export interface ActiveWindow {
  windowId: ChromeWindowId;
  lastActiveTabInfo: LastActiveTabInfo;
  primaryTabActivationInfo: PrimaryTabActivationTimeoutInfo | null;
  tabGroupHighlightColors: { primary: chrome.tabGroups.ColorEnum; nonPrimary: chrome.tabGroups.ColorEnum } | null;
  tabGroups: ChromeTabGroupWithId[];
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

export interface LastActiveTabInfo {
  tabId: ChromeTabId;
  tabGroupId: ChromeTabGroupId;
  title: string | undefined;
}

export interface PrimaryTabActivationTimeoutInfo {
  tabId: ChromeTabId;
  timeoutId: number;
  timeoutPeriod: number;
}
export interface LastGroupedTabInfo {
  tabId: ChromeTabId;
  tabGroupId: ChromeTabGroupId;
}

export type YesOrNo = "yes" | "no";
export type YesOrNoOrNA = "yes" | "no" | "n/a";
