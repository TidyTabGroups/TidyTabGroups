import { ChromeWindowWithId, ChromeTabId, TabGroupCreationOptions, ChromeTabWithId, ChromeWindowId } from "../../types";
import { TidyTabs, ChromeTabGroupWithId } from "../../types";

export const SECONDARY_TAB_GROUP_TITLE = "      ←      ";
export const MAX_PRIMARY_TABS = 1;

export function getWindowsWithIds(windows: chrome.windows.Window[]) {
  // "Under some circumstances a Window may not be assigned an ID, for example when querying windows using the sessions API, in which case a session ID may be present."
  return windows.filter(
    (window) => window.id !== undefined && window.id !== chrome.windows.WINDOW_ID_NONE
  ) as Array<ChromeWindowWithId>;
}

export function getTabsWithIds(tabs: chrome.tabs.Tab[]) {
  // "Under some circumstances a Tab may not be assigned an ID, for example when querying foreign tabs using the sessions API, in which case a session ID may be present. Tab ID can also be set to chrome.tabs.TAB_ID_NONE for apps and devtools windows."
  return tabs.filter((tab) => tab.id !== undefined && tab.id !== chrome.tabs.TAB_ID_NONE) as Array<ChromeTabWithId>;
}

export async function createTabGroup(tabIds: [ChromeTabId], options?: TabGroupCreationOptions) {
  try {
    const { windowId, title, color } = options || {};
    const tabGroupId = await chrome.tabs.group({ tabIds, createProperties: { windowId } });
    if (title || color) {
      await chrome.tabGroups.update(tabGroupId, { title, color });
    }
    return tabGroupId;
  } catch (error) {
    console.error(`TidyTabsChromeHelper::createTabGroup::Error ${error}`);
    throw error;
  }
}

export function tabGroupWasCollapsed(tabGroup: chrome.tabGroups.TabGroup, prevTabGroup: chrome.tabGroups.TabGroup) {
  return tabGroup.collapsed && !prevTabGroup.collapsed;
}

export function tabGroupWasExpanded(tabGroup: chrome.tabGroups.TabGroup, prevTabGroup: chrome.tabGroups.TabGroup) {
  return !tabGroup.collapsed && prevTabGroup.collapsed;
}

export function isTab(object: any): object is chrome.tabs.Tab {
  const properties = [
    "active",
    "audible",
    "autoDiscardable",
    "discarded",
    "groupId",
    "height",
    "highlighted",
    "id",
    "incognito",
    "index",
    "mutedInfo",
    "pinned",
    "selected",
    "status",
    "width",
    "windowId",
  ];

  return object && properties.every((property) => property in object);
}

export function isTabGroup(object: any): object is chrome.tabGroups.TabGroup {
  const properties = ["collapsed", "color", "id", "title", "windowId"];

  return object && properties.every((property) => property in object);
}

export function isWindow(object: any): object is chrome.windows.Window {
  const properties = ["alwaysOnTop", "focused", "height", "id", "incognito", "left", "state", "top", "type", "width"];

  return object && properties.every((property) => property in object);
}
