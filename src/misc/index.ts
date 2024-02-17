import { ChromeTabId, TabGroupCreationOptions } from "../types";

const USER_OS_TYPE: "windows" | "macos" | "linux" = "windows";

export const SECONDARY_TAB_GROUP_TITLE_LEFT_MAC = "←";
export const SECONDARY_TAB_GROUP_TITLE_RIGHT_MAC = "TODO";
export const SECONDARY_TAB_GROUP_TITLE_LEFT_WINDOWS = "<";
export const SECONDARY_TAB_GROUP_TITLE_RIGHT_WINDOWS = ">";

export const SECONDARY_TAB_GROUP_TITLE_LEFT =
  USER_OS_TYPE === "windows"
    ? SECONDARY_TAB_GROUP_TITLE_LEFT_WINDOWS
    : SECONDARY_TAB_GROUP_TITLE_LEFT_MAC;
export const SECONDARY_TAB_GROUP_TITLE_RIGHT =
  USER_OS_TYPE === "windows"
    ? SECONDARY_TAB_GROUP_TITLE_RIGHT_WINDOWS
    : SECONDARY_TAB_GROUP_TITLE_RIGHT_MAC;

export const MAX_PRIMARY_TABS = 1;

export function isMiscTabGroupTitle(tabGroupTitle: String) {
  return (
    tabGroupTitle === SECONDARY_TAB_GROUP_TITLE_LEFT ||
    tabGroupTitle === SECONDARY_TAB_GROUP_TITLE_RIGHT
  );
}

export async function createTabGroup(tabIds: [ChromeTabId], options?: TabGroupCreationOptions) {
  try {
    const { windowId, title, color } = options || {};
    const tabGroupId = await chrome.tabs.group({
      tabIds,
      createProperties: { windowId },
    });
    if (title || color) {
      await chrome.tabGroups.update(tabGroupId, { title, color });
    }
    return tabGroupId;
  } catch (error) {
    console.error(`TidyTabsChromeHelper::createTabGroup::Error ${error}`);
    throw error;
  }
}

export function tabGroupWasCollapsed(
  tabGroup: chrome.tabGroups.TabGroup,
  prevTabGroup: chrome.tabGroups.TabGroup
) {
  return tabGroup.collapsed && !prevTabGroup.collapsed;
}

export function tabGroupWasExpanded(
  tabGroup: chrome.tabGroups.TabGroup,
  prevTabGroup: chrome.tabGroups.TabGroup
) {
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
  const properties = [
    "alwaysOnTop",
    "focused",
    "height",
    "id",
    "incognito",
    "left",
    "state",
    "top",
    "type",
    "width",
  ];

  return object && properties.every((property) => property in object);
}