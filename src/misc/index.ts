import { ChromeTabId, ChromeTabWithId, ChromeWindowId, TabGroupCreationOptions } from "../types";

const USER_OS_TYPE: "windows" | "macos" | "linux" = "windows";

export const MAX_PRIMARY_TABS = 1;

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
  tabGroupCollapsed: chrome.tabGroups.TabGroup["collapsed"],
  prevTabGroupCollapsed: chrome.tabGroups.TabGroup["collapsed"]
) {
  return tabGroupCollapsed && !prevTabGroupCollapsed;
}

export function tabGroupWasExpanded(
  tabGroupCollapsed: chrome.tabGroups.TabGroup["collapsed"],
  prevTabGroupCollapsed: chrome.tabGroups.TabGroup["collapsed"]
) {
  return !tabGroupCollapsed && prevTabGroupCollapsed;
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

// opens a dummy tab in windows that have a chrome://extensions/* tab open
export async function openDummyTab() {
  const lastFocusedWindow = await chrome.windows.getLastFocused();
  const [activeTab] = await chrome.tabs.query({ windowId: lastFocusedWindow.id, active: true });

  if (!activeTab || !activeTab.url) {
    return;
  }

  const activeTabUrl = new URL(activeTab.url);
  if (activeTabUrl.origin === "chrome://extensions") {
    chrome.tabs.create({ windowId: lastFocusedWindow.id, url: "dummy-page.html", active: false, index: activeTab.index + 1 });
  }
}
