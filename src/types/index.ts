export type ChromeId = number;
export type ChromeWindowId = ChromeId;
export type ChromeTabGroupId = ChromeId;
export type ChromeTabId = ChromeId;

export type ChromeWindowWithId = chrome.windows.Window & { id: ChromeWindowId };
export type ChromeTabGroupWithId = chrome.tabGroups.TabGroup & { id: ChromeTabGroupId };
export type ChromeTabWithId = chrome.tabs.Tab & { id: ChromeTabId };

export interface TabGroupCreationOptions {
  windowId?: ChromeWindowId;
  title?: string;
  color?: chrome.tabGroups.ColorEnum;
}

export declare namespace TidyTabs {
  export interface SpaceActiveData {
    windowId: ChromeWindowId;
    activeTab?: ChromeTabWithId; // not set when a pinned tab in the window is active
    secondaryTabGroup: ChromeTabGroupWithId;
    primaryTabGroup: ChromeTabGroupWithId;
  }

  export interface SpaceCreateProperties {
    id?: string;
    primaryTab: Tab;
    secondaryTabs: Tab[];

    activeData?: SpaceActiveData;
  }

  export interface Space extends SpaceCreateProperties {
    id: string;
  }

  export interface TabCreateProperties {
    id?: string;
    overridenTitle?: string;
    homeUrl?: string;
    activeData?: {
      tabId?: ChromeTabId;
    };
  }

  export interface Tab extends TabCreateProperties {
    id: string;
  }

  export interface DataModel {
    activeSpaces: Array<Space>;
  }

  export type SpaceSyncDataType = "tab" | "tabGroup";

  export interface SpaceSyncData<T extends SpaceSyncDataType> {
    windowId: ChromeWindowId;
    activeSpace: TidyTabs.Space;
    type: T;
    data: T extends "tab" ? ChromeTabWithId : ChromeTabGroupWithId;
  }
}
