import { DBSchema } from "idb";
import { ChromeTabId, ChromeWindowId, ChromeTabGroupId, ChromeTabGroupWithId } from "..";

export declare namespace DataModel {
  export interface BaseActiveTabCreateProperties {
    id?: string;
    tabInfo: {
      id: ChromeTabId;
      url?: string;
      title?: string;
    };
  }

  export interface BaseActiveTab extends BaseActiveTabCreateProperties {
    id: string;
  }

  export interface ActiveTabCreateProperties extends BaseActiveTabCreateProperties {
    activeWindowId: string;
    activeSpaceId: string | null;
  }

  export type ActiveTab = BaseActiveTab & ActiveTabCreateProperties;

  export interface BaseActiveSpaceCreateProperties {
    id?: string;
    tabGroupInfo: {
      id: chrome.tabGroups.TabGroup["id"];
      title?: chrome.tabGroups.TabGroup["title"];
      color: chrome.tabGroups.TabGroup["color"];
      collapsed: chrome.tabGroups.TabGroup["collapsed"];
    };
  }

  export interface BaseActiveSpace extends BaseActiveSpaceCreateProperties {
    id: string;
  }

  export interface ActiveSpaceCreateProperties extends BaseActiveSpaceCreateProperties {
    activeWindowId: string;
  }

  export type ActiveSpace = BaseActiveSpace & ActiveSpaceCreateProperties;

  export interface ActiveWindowCreateProperties {
    id?: string;
    windowId: ChromeWindowId;
    selectedSpaceId: string | null;
    selectedTabId: string;
    primarySpaceId: string | null;
    /*
      primaryFocus: the primary tab group is selected
      peakFocus: the selected space is being "peaked"
      nonSpaceTabFocus: a tab that doesnt belong to any space is selected
     */
    selectedSpaceFocusType: "primaryFocus" | "peakFocus" | "nonSpaceTabFocus";
  }

  export type ActiveWindow = { id: string } & ActiveWindowCreateProperties;

  export interface BaseSpaceAutoCollapseTimerCreateProperties {
    id?: string;
    time: number;
  }

  export interface SpaceAutoCollapseTimerCreateProperties extends BaseSpaceAutoCollapseTimerCreateProperties {
    activeWindowId: string;
    spaceId: string;
  }

  export type SpaceAutoCollapseTimer = { id: string } & SpaceAutoCollapseTimerCreateProperties;

  export interface ModelDB extends DBSchema {
    activeWindows: {
      value: ActiveWindow;
      key: string;
      indexes: { windowId: ActiveWindow["windowId"] };
    };
    activeSpaces: {
      value: ActiveSpace;
      key: string;
      indexes: { activeWindowId: ActiveSpace["activeWindowId"]; tabGroupId: ActiveSpace["tabGroupInfo"]["id"] };
    };
    activeTabs: {
      value: ActiveTab;
      key: string;
      indexes: { activeWindowId: ActiveWindow["id"]; activeSpaceId: ActiveSpace["id"]; tabId: ActiveTab["tabInfo"]["id"] };
    };
    spaceAutoCollapseTimers: {
      value: SpaceAutoCollapseTimer;
      key: string;
      indexes: { activeWindowId: ActiveWindow["id"]; activeSpaceId: ActiveSpace["id"] };
    };
  }
}
