import { DBSchema } from "idb";
import { ChromeTabId, ChromeWindowId, ChromeTabGroupId, ChromeTabGroupWithId } from "..";

export declare namespace DataModel {
  export interface TabCreateProperties {
    id?: string;
  }

  export interface ActiveTabCreateProperties extends TabCreateProperties {
    tabInfo: {
      id: ChromeTabId;
      url?: string;
      title?: string;
    };
  }

  export interface BaseTab {
    id: string;
  }

  export type Tab = BaseTab & TabCreateProperties;
  export type ActiveTab = BaseTab & ActiveTabCreateProperties;

  export interface SpaceCreateProperties {
    id?: string;
    tabs: Tab[];
  }

  export interface ActiveSpaceCreateProperties extends SpaceCreateProperties {
    windowId: ChromeWindowId;
    tabGroupInfo: {
      id: chrome.tabGroups.TabGroup["id"];
      title: chrome.tabGroups.TabGroup["title"];
      color: chrome.tabGroups.TabGroup["color"];
      collapsed: chrome.tabGroups.TabGroup["collapsed"];
    };
    tabs: ActiveTab[];
  }

  export interface BaseSpace {
    id: string;
  }

  export type Space = BaseSpace & SpaceCreateProperties;
  export type ActiveSpace = BaseSpace & ActiveSpaceCreateProperties;

  export interface BaseWindow {
    id: string;
  }

  export interface ActiveWindowCreateProperties {
    id?: string;
    windowId: ChromeWindowId;
    spaces: ActiveSpace[]; // in order of how they appear in the tab bar
    selectedSpaceId: string | null;
    selectedTabId: string;
    primarySpaceId: string | null;
    /*
      primaryFocus: the primary tab group is selected
      secondaryFocus: the secondary tab group is selected
      peakFocus: the selected space is being "peaked"
      nonSpaceTabFocus: a tab that doesnt belong to any space is selected
     */
    selectedSpaceFocusType: "primaryFocus" | "secondaryFocus" | "peakFocus" | "nonSpaceTabFocus";
    secondaryTabGroup: ChromeTabGroupWithId | null;
    nonGroupedTabs: ActiveTab[];
  }

  export type ActiveWindow = BaseWindow & ActiveWindowCreateProperties;

  export interface SpaceAutoCollapseTimer {
    id: string;
    activeWindowId: string;
    spaceId: string;
    time: number;
  }

  export interface Model {
    activeWindows: ActiveWindow[];
  }

  export interface ModelDB extends DBSchema {
    activeWindows: {
      value: ActiveWindow;
      key: string;
      indexes: { window: "windowId" };
    };
    activeSpaces: {
      value: ActiveSpace;
      key: string;
      indexes: { activeWindow: "activeWindowId" };
    };
    activeTabs: {
      value: ActiveTab;
      key: string;
      indexes: { activeWindow: "activeWindowId"; activeSpace: "activeSpaceId" };
    };
    spaceAutoCollapseTimers: {
      value: SpaceAutoCollapseTimer;
      key: string;
      indexes: { activeWindow: "activeWindowId"; activeSpace: "spaceId" };
    };
  }
}
