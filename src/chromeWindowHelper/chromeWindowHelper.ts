import { ChromeWindowId, ChromeTabWithId, ChromeTabGroupWithId, ChromeTabId, ChromeTabGroupId } from "../types/types";
import Misc from "../misc";

export async function getTabGroupsOrdered(
  windowIdOrTabs: ChromeWindowId | ChromeTabWithId[],
  tabGroupsToOrderOrQueryInfo?: ChromeTabGroupWithId[] | chrome.tabGroups.QueryInfo
) {
  const tabGroupsToOrder = Array.isArray(tabGroupsToOrderOrQueryInfo) ? tabGroupsToOrderOrQueryInfo : undefined;
  // Since querying tabs returns them in an ordered list, we can use that data to get the ordered list of tab group ids
  if ((Array.isArray(windowIdOrTabs) && windowIdOrTabs.length === 0) || tabGroupsToOrder?.length === 0) {
    return [];
  }

  const windowId = Array.isArray(windowIdOrTabs) ? windowIdOrTabs[0]?.windowId : windowIdOrTabs;
  const tabs = Array.isArray(windowIdOrTabs) ? (windowIdOrTabs as ChromeTabWithId[]) : ((await chrome.tabs.query({ windowId })) as ChromeTabWithId[]);
  const remainingTabGroupsToOrder = tabGroupsToOrder || (await chrome.tabGroups.query({ windowId, ...tabGroupsToOrderOrQueryInfo }));
  const orderedTabGroups: ChromeTabGroupWithId[] = [];

  tabs.forEach((tab) => {
    if (tab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE && orderedTabGroups[orderedTabGroups.length - 1]?.id !== tab.groupId) {
      const tabGroup = remainingTabGroupsToOrder.find((remaingTabGroupToOrder) => remaingTabGroupToOrder.id === tab.groupId);
      orderedTabGroups.push(tabGroup!);
    }
  });
  return orderedTabGroups;
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

  const updatePromise = callWithUserTabDraggingHandler(() => chrome.tabs.update(tabId, updatedProperties));
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

  const updatePromise = callWithUserTabDraggingHandler(() => chrome.tabs.update(tabId, { active: true }));
  return await Promise.all([onActivatedPromise, updatePromise]);
}

export async function updateTabGroupAndWait(tabGroupId: ChromeTabGroupId, updatedProperties: chrome.tabGroups.UpdateProperties) {
  const onUpdatedPromise = new Promise<ChromeTabGroupWithId>((resolve, reject) => {
    chrome.tabGroups.onUpdated.addListener(async function onUpdated(updatedTabGroup: chrome.tabGroups.TabGroup) {
      if (updatedTabGroup.id === tabGroupId) {
        chrome.tabGroups.onUpdated.removeListener(onUpdated);
        resolve(updatedTabGroup);
      }
    });
  });

  const updatePromise = callWithUserTabDraggingHandler(() => chrome.tabGroups.update(tabGroupId, updatedProperties));
  const [updatedTabGroup] = await Promise.all([onUpdatedPromise, updatePromise]);
  return updatedTabGroup;
}

export async function moveTabAndWait(tabId: ChromeTabId, moveProperties: chrome.tabs.MoveProperties) {
  const onMovedPromise = new Promise<void>((resolve, reject) => {
    chrome.tabs.onMoved.addListener(async function onMoved(movedTabId: ChromeTabId, moveInfo: chrome.tabs.TabMoveInfo) {
      if (movedTabId === tabId) {
        chrome.tabs.onMoved.removeListener(onMoved);
        resolve();
      }
    });
  });

  const movePromise = callWithUserTabDraggingHandler(() => chrome.tabs.move(tabId, moveProperties));
  return await Promise.all([onMovedPromise, movePromise]);
}

export async function moveTabGroupAndWait(tabGroupId: ChromeTabGroupId, moveProperties: chrome.tabGroups.MoveProperties) {
  const onMovedPromise = new Promise<void>((resolve, reject) => {
    chrome.tabGroups.onMoved.addListener(async function onMoved(movedTabGroup: chrome.tabGroups.TabGroup) {
      if (movedTabGroup.id === tabGroupId) {
        chrome.tabGroups.onMoved.removeListener(onMoved);
        resolve();
      }
    });
  });

  const movePromise = callWithUserTabDraggingHandler(() => chrome.tabGroups.move(tabGroupId, moveProperties));
  return await Promise.all([onMovedPromise, movePromise]);
}

export async function callWithUserTabDraggingHandler(fn: () => Promise<any>): Promise<any> {
  try {
    return await fn();
  } catch (error) {
    // @ts-ignore
    if (error?.message === "Tabs cannot be edited right now (user may be dragging a tab).") {
      console.log(`callWithUserTabDraggingHandler::user may be dragging a tab: `, fn.toString());
      await callWithUserTabDraggingHandler(fn);
    } else {
      throw error;
    }
  }
}

export async function waitForTabToLoad(tabOrTabId: ChromeTabId | ChromeTabWithId) {
  const tab = await Misc.getTabFromTabOrTabId(tabOrTabId);
  if (tab.status === "complete") {
    return;
  }

  return new Promise<void>((resolve) => {
    chrome.tabs.onUpdated.addListener(function onUpdated(tabId, changeInfo, tab) {
      if (tabId === tab.id && changeInfo.status === "complete") {
        chrome.tabs.onUpdated.removeListener(onUpdated);
        resolve();
      }
    });
  });
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

export async function doesTabExist(tabId: ChromeTabId) {
  try {
    await chrome.tabs.get(tabId);
    return true;
  } catch (error) {
    return false;
  }
}