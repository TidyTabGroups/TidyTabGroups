import {
  ChromeWindowId,
  ChromeTabWithId,
  ChromeTabGroupWithId,
  ChromeTabId,
  ChromeTabGroupId,
  ChromeTabGroupUpdateProperties,
  ChromeTabGroupColorEnum,
} from "../types/types";
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

export async function activateTab(tabId: ChromeTabId) {
  return waitForUserTabDraggingUsingCall(() => chrome.tabs.update(tabId, { active: true }));
}

export async function updateTabGroup(tabGroupId: ChromeTabGroupId, updatedProperties: ChromeTabGroupUpdateProperties) {
  try {
    return await waitForUserTabDraggingUsingCall(() => chrome.tabGroups.update(tabGroupId, updatedProperties));
  } catch (error) {
    // FIXME: remove this once saved tab groups are editable
    // @ts-ignore
    if (error?.message.toLowerCase().includes("saved groups are not editable")) {
      console.warn(`updateTabGroup::saved tab group with id ${tabGroupId} is not editable: `, error);
      return await chrome.tabGroups.get(tabGroupId);
    } else {
      throw error;
    }
  }
}

export async function moveTab(tabId: ChromeTabId, moveProperties: chrome.tabs.MoveProperties) {
  return waitForUserTabDraggingUsingCall(() => chrome.tabs.move(tabId, moveProperties));
}

export async function moveTabGroup(tabGroupId: ChromeTabGroupId, moveProperties: chrome.tabGroups.MoveProperties) {
  return waitForUserTabDraggingUsingCall(() => chrome.tabGroups.move(tabGroupId, moveProperties));
}

export async function waitForUserTabDraggingUsingCall<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    // @ts-ignore
    if (error?.message === "Tabs cannot be edited right now (user may be dragging a tab).") {
      console.log(`waitForUserTabDraggingUsingCall::user may be dragging a tab: `, fn.toString());
      return new Promise((resolve) => setTimeout(() => resolve(waitForUserTabDraggingUsingCall(fn)), 100));
    } else {
      throw error;
    }
  }
}

export async function waitForTabToLoad(tabOrTabId: ChromeTabId | ChromeTabWithId, forceLoad: boolean = false) {
  return new Promise<boolean>(async (resolve, reject) => {
    const waitForTabId = typeof tabOrTabId === "number" ? tabOrTabId : tabOrTabId.id;
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.onRemoved.addListener(onRemoved);

    const tab = await Misc.getTabFromTabOrTabId(tabOrTabId);
    if (!tab) {
      removeListenersAndResolve(true);
      return;
    }

    if (tab.status === "unloaded") {
      if (forceLoad) {
        await chrome.tabs.update(waitForTabId, { url: tab.url });
      } else {
        removeListenersAndReject(new Error(`waitForTabToLoad::tab is in an unloaded state, and the forceLoad option is false`));
      }
    } else if (tab.status === "complete") {
      removeListenersAndResolve(false);
    }

    function removeListenersAndResolve(wasRemoved: boolean) {
      removeListeners();
      resolve(wasRemoved);
    }

    function removeListenersAndReject(error: any) {
      removeListeners();
      reject(error);
    }

    function removeListeners() {
      chrome.tabs.onUpdated.removeListener(onUpdated);
      chrome.tabs.onRemoved.removeListener(onRemoved);
    }

    function onUpdated(tabId: ChromeTabId, changeInfo: chrome.tabs.TabChangeInfo) {
      if (tabId === waitForTabId && changeInfo.status === "complete") {
        removeListenersAndResolve(false);
      }
    }

    function onRemoved(tabId: ChromeTabId) {
      if (tabId === waitForTabId) {
        removeListenersAndResolve(true);
      }
    }
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

export async function getIfTabExists(tabId: ChromeTabId) {
  try {
    return (await chrome.tabs.get(tabId)) as ChromeTabWithId;
  } catch (error) {}
}

export async function doesTabExist(tabId: ChromeTabId) {
  const tab = await getIfTabExists(tabId);
  return !!tab;
}

export async function getIfTabGroupExists(tabGroupId: ChromeTabGroupId) {
  try {
    return await chrome.tabGroups.get(tabGroupId);
  } catch (error) {}
}

export async function doesTabGroupExist(tabGroupId: ChromeTabGroupId) {
  const tabGroup = await getIfTabGroupExists(tabGroupId);
  return !!tabGroup;
}

export async function getIfWindowExists(windowId: ChromeWindowId) {
  try {
    return await chrome.windows.get(windowId);
  } catch (error) {}
}

export async function doesWindowExist(windowId: ChromeWindowId) {
  const window = await getIfWindowExists(windowId);
  return !!window;
}

export async function discardTabIfNotDiscarded(tabId: ChromeTabId) {
  try {
    await chrome.tabs.discard(tabId);
    return true;
  } catch (error) {
    console.error(`discardTabIfNotDiscarded::failed to discard tab: `, error);
    return false;
  }
}

// Checks if tab is scriptable by attempting to send it a message. Some tabs may not be scriptable, for example chrome://*,
// the chrome web store, accounts.google.com. Returns [isScriptable, wasRemoved]. If wasRemoved is true, the tab was removed
// before it loaded. In this case, isScriptable is also false.
export async function isTabScriptable(tabId: ChromeTabId, waitForLoadOptions?: boolean | { forceLoad: boolean }) {
  if (waitForLoadOptions) {
    const forceLoad = typeof waitForLoadOptions === "boolean" ? false : waitForLoadOptions.forceLoad;
    const wasRemoved = await waitForTabToLoad(tabId, forceLoad);
    if (wasRemoved) {
      return [false, true] as const;
    }
  }

  return new Promise<readonly [boolean, boolean]>((resolve) => {
    chrome.tabs.sendMessage(tabId, { type: "ping" }, { frameId: 0 }, async () => {
      if (chrome.runtime.lastError) {
        console.warn(`isTabScriptable::chrome.runtime.lastError for ${tabId}:`, chrome.runtime.lastError.message);
        resolve([false, false] as const);
      } else {
        resolve([true, false] as const);
      }
    });
  });
}

export async function getLastAccessedTabInWindow(windowIdOrTabs: ChromeWindowId | ChromeTabWithId[]) {
  const tabs = Array.isArray(windowIdOrTabs) ? windowIdOrTabs : ((await chrome.tabs.query({ windowId: windowIdOrTabs })) as ChromeTabWithId[]);
  return getLastAccessedTab(tabs);
}

export async function getLastAccessedTabInTabGroup(tabGroupIdOrTabs: ChromeTabGroupId | ChromeTabWithId[]) {
  const tabs = Array.isArray(tabGroupIdOrTabs) ? tabGroupIdOrTabs : ((await chrome.tabs.query({ groupId: tabGroupIdOrTabs })) as ChromeTabWithId[]);
  return getLastAccessedTab(tabs);
}

export function getLastAccessedTab(tabs: ChromeTabWithId[]) {
  let lastAccessedTab: ChromeTabWithId | undefined;
  tabs.forEach((tab) => {
    if (tab.lastAccessed !== undefined && (lastAccessedTab?.lastAccessed === undefined || tab.lastAccessed > lastAccessedTab.lastAccessed)) {
      lastAccessedTab = tab;
    }
  });
  return lastAccessedTab;
}

export async function getTabsOrderedByLastAccessed(windowIdOrTabs: ChromeWindowId | ChromeTabWithId[]) {
  const tabs = Array.isArray(windowIdOrTabs) ? windowIdOrTabs : ((await chrome.tabs.query({ windowId: windowIdOrTabs })) as ChromeTabWithId[]);
  return tabs.sort((tab1, tab2) => (tab1.lastAccessed || 0) - (tab2.lastAccessed || 0));
}

export async function focusTabGroup(
  tabGroupId: ChromeTabGroupId,
  tabGroupsOrWindowId: ChromeTabGroupWithId[] | ChromeWindowId,
  options: {
    collapseUnfocusedTabGroups: boolean;
    highlightColors?: { focused: chrome.tabGroups.ColorEnum; nonFocused: chrome.tabGroups.ColorEnum };
  }
) {
  const tabGroups = Array.isArray(tabGroupsOrWindowId)
    ? tabGroupsOrWindowId
    : ((await chrome.tabGroups.query({ windowId: tabGroupsOrWindowId })) as ChromeTabGroupWithId[]);

  const { collapseUnfocusedTabGroups, highlightColors } = options;

  return await Promise.all(
    tabGroups.map(async (tabGroup) => {
      const updateProps: chrome.tabGroups.UpdateProperties = {};

      if (tabGroup.id === tabGroupId) {
        if (tabGroup.collapsed) {
          updateProps.collapsed = false;
        }
        if (highlightColors?.focused && highlightColors.focused !== tabGroup.color) {
          updateProps.color = highlightColors.focused;
        }
      } else {
        if (collapseUnfocusedTabGroups && !tabGroup.collapsed) {
          updateProps.collapsed = true;
        }
        if (highlightColors?.nonFocused && highlightColors.nonFocused !== tabGroup.color) {
          updateProps.color = highlightColors.nonFocused;
        }
      }

      if (Object.keys(updateProps).length > 0) {
        return await updateTabGroup(tabGroup.id, updateProps);
      }
      return tabGroup;
    })
  );
}

// FIXME: remove the "orange" explicit type once the chrome.tabGroups.ColorEnum type is updated
export const TAB_GROUP_COLORS: Array<ChromeTabGroupColorEnum> = ["grey", "blue", "red", "yellow", "green", "pink", "purple", "cyan", "orange"];
