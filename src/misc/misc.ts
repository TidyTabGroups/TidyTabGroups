import { ChromeTabGroupId, ChromeTabGroupWithId, ChromeTabId, ChromeTabWithId, ChromeWindowId } from "../types/types";

export function onWindowError(windowId: ChromeWindowId) {
  // TODO: re-activate the window
}

export async function getTabGroupsOrdered(windowIdOrTabs: ChromeWindowId | ChromeTabWithId[], tabGroupsToOrder?: ChromeTabGroupWithId[]) {
  // Since querying tabs returns them in an ordered list, we can use that data to get the ordered list of tab group ids
  if ((Array.isArray(windowIdOrTabs) && windowIdOrTabs.length === 0) || tabGroupsToOrder?.length === 0) {
    return [];
  }

  const windowId = Array.isArray(windowIdOrTabs) ? windowIdOrTabs[0]?.windowId : windowIdOrTabs;
  const tabs = Array.isArray(windowIdOrTabs) ? (windowIdOrTabs as ChromeTabWithId[]) : ((await chrome.tabs.query({ windowId })) as ChromeTabWithId[]);
  const remainingTabGroupsToOrder = tabGroupsToOrder ? tabGroupsToOrder : await chrome.tabGroups.query({ windowId });
  const orderedTabGroups: ChromeTabGroupWithId[] = [];

  tabs.forEach((tab) => {
    if (tab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE && orderedTabGroups[orderedTabGroups.length - 1]?.id !== tab.groupId) {
      const tabGroup = remainingTabGroupsToOrder.find((remaingTabGroupToOrder) => remaingTabGroupToOrder.id === tab.groupId);
      orderedTabGroups.push(tabGroup!);
    }
  });
  return orderedTabGroups;
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

export async function updateTabAndWait(tabId: ChromeTabId, updatedProperties: chrome.tabs.UpdateProperties) {
  const onUpdatedPromise = new Promise<void>((resolve, reject) => {
    chrome.tabs.onUpdated.addListener(async function onUpdated(updatedTabId: ChromeTabId, changeInfo: any) {
      if (updatedTabId === tabId) {
        chrome.tabs.onUpdated.removeListener(onUpdated);
        resolve();
      }
    });
  });

  const updatePromise = chrome.tabs.update(tabId, updatedProperties);
  return await Promise.all([onUpdatedPromise, updatePromise]);
}

export async function activateTabAndWait(tabId: ChromeTabId) {
  const onActivatedPromise = new Promise<void>((resolve, reject) => {
    chrome.tabs.onActivated.addListener(async function onActivated(activeInfo: chrome.tabs.TabActiveInfo) {
      if (activeInfo.tabId === tabId) {
        chrome.tabs.onActivated.removeListener(onActivated);
        resolve();
      }
    });
  });

  const updatePromise = chrome.tabs.update(tabId, { active: true });
  return await Promise.all([onActivatedPromise, updatePromise]);
}

export async function updateTabGroupAndWait(tabGroupId: ChromeTabGroupId, updatedProperties: chrome.tabGroups.UpdateProperties) {
  const onUpdatedPromise = new Promise<void>((resolve, reject) => {
    chrome.tabGroups.onUpdated.addListener(async function onUpdated(updatedTabGroup: chrome.tabGroups.TabGroup) {
      if (updatedTabGroup.id === tabGroupId) {
        chrome.tabGroups.onUpdated.removeListener(onUpdated);
        resolve();
      }
    });
  });

  const updatePromise = chrome.tabGroups.update(tabGroupId, updatedProperties);
  return await Promise.all([onUpdatedPromise, updatePromise]);
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
