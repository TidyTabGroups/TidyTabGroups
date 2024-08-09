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
import ChromeTabOperationRetryHandler from "../chromeTabOperationRetryHandler";
import Logger from "../logger";

const logger = Logger.createLogger("chromeWindowHelper");

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
  const operationHandler = new ChromeTabOperationRetryHandler<ChromeTabWithId, true>();
  operationHandler.setShouldRetryOperationCallback(async () => {
    const activeTabUpToDate = await getIfTabExists(tabId);
    return !!activeTabUpToDate;
  });
  return await operationHandler.try(chrome.tabs.update(tabId, { active: true }) as Promise<ChromeTabWithId>);
}

export async function updateTabGroup<ShouldRetryCall extends boolean = false>(
  tabGroupId: ChromeTabGroupId,
  updatedProperties: ChromeTabGroupUpdateProperties,
  shouldRetryCallAfterUserIsDoneTabDragging?: ShouldRetryCall extends true ? () => Promise<boolean> : never
) {
  try {
    return await callAfterUserIsDoneTabDragging<ChromeTabGroupWithId, ShouldRetryCall>(
      () => chrome.tabGroups.update(tabGroupId, updatedProperties),
      shouldRetryCallAfterUserIsDoneTabDragging
    );
  } catch (error) {
    // FIXME: remove this once saved tab groups are editable
    // @ts-ignore
    if (error?.message.toLowerCase().includes("saved groups are not editable")) {
      console.warn(`updateTabGroup::saved tab group with id ${tabGroupId} is not editable: `, error);
      return (await chrome.tabGroups.get(tabGroupId)) as ChromeTabGroupWithId;
    } else {
      throw error;
    }
  }
}

export async function moveTab(tabId: ChromeTabId, moveProperties: chrome.tabs.MoveProperties) {
  return callAfterUserIsDoneTabDragging(() => chrome.tabs.move(tabId, moveProperties) as Promise<ChromeTabWithId>);
}

export async function moveTabGroup(tabGroupId: ChromeTabGroupId, moveProperties: chrome.tabGroups.MoveProperties) {
  return callAfterUserIsDoneTabDragging(() => chrome.tabGroups.move(tabGroupId, moveProperties) as Promise<ChromeTabGroupWithId>);
}

export async function groupTabs<ShouldRetryCall extends boolean = false>(
  options: chrome.tabs.GroupOptions,
  shouldRetryCallAfterUserIsDoneTabDragging?: ShouldRetryCall extends true ? () => Promise<boolean> : never
) {
  return callAfterUserIsDoneTabDragging<ChromeTabGroupId, ShouldRetryCall>(
    () => chrome.tabs.group(options),
    shouldRetryCallAfterUserIsDoneTabDragging
  );
}

export async function callAfterUserIsDoneTabDragging<T, ShouldRetryCall extends boolean = false>(
  fn: () => Promise<T>,
  shouldRetryCall?: ShouldRetryCall extends true ? () => Promise<boolean> : never
): Promise<ShouldRetryCall extends true ? T | void : T> {
  try {
    return await fn();
  } catch (error) {
    // @ts-ignore
    if (error?.message === "Tabs cannot be edited right now (user may be dragging a tab).") {
      console.log(`callAfterUserIsDoneTabDragging::user may be dragging a tab: `, fn.toString());
      return new Promise((resolve, reject) =>
        setTimeout(async () => {
          const shouldRetry = shouldRetryCall ? await shouldRetryCall() : true;
          if (shouldRetry) {
            callAfterUserIsDoneTabDragging(fn, shouldRetryCall).then(resolve).catch(reject);
          } else {
            resolve(undefined as ShouldRetryCall extends true ? T | void : T);
          }
        }, 100)
      );
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

export async function queryTabsIfWindowExists(windowId: ChromeWindowId, otherQueryInfo?: chrome.tabs.QueryInfo) {
  try {
    return (await chrome.tabs.query({ ...otherQueryInfo, windowId })) as ChromeTabWithId[];
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

export async function focusTabGroup<ShouldRetryCall extends boolean = false>(
  tabGroupId: ChromeTabGroupId,
  tabGroupsOrWindowId: ChromeTabGroupWithId[] | ChromeWindowId,
  options: {
    collapseUnfocusedTabGroups: boolean;
    highlightColors?: { focused: chrome.tabGroups.ColorEnum; nonFocused: chrome.tabGroups.ColorEnum };
  },
  shouldRetryCallAfterUserIsDoneTabDragging?: ShouldRetryCall extends true ? () => Promise<boolean> : never
) {
  const tabGroups = Array.isArray(tabGroupsOrWindowId)
    ? tabGroupsOrWindowId
    : ((await chrome.tabGroups.query({ windowId: tabGroupsOrWindowId })) as ChromeTabGroupWithId[]);

  const { collapseUnfocusedTabGroups, highlightColors } = options;

  const updatedTabGroups = (await Promise.all(
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
        return await updateTabGroup<ShouldRetryCall>(tabGroup.id, updateProps, shouldRetryCallAfterUserIsDoneTabDragging);
      }
    })
  )) as (ChromeTabGroupWithId | undefined)[];

  return updatedTabGroups.filter((tabGroup) => !!tabGroup) as ChromeTabGroupWithId[];
}

// FIXME: remove the "orange" explicit type once the chrome.tabGroups.ColorEnum type is updated
export const TAB_GROUP_COLORS: Array<ChromeTabGroupColorEnum> = ["grey", "blue", "red", "yellow", "green", "pink", "purple", "cyan", "orange"];

export function tabGroupEquals(tabGroup: ChromeTabGroupWithId, tabGroupToCompare: ChromeTabGroupWithId) {
  const keys = Object.keys(tabGroupToCompare) as (keyof chrome.tabGroups.TabGroup)[];
  if (keys.length !== Object.keys(tabGroup).length || keys.find((key) => tabGroupToCompare[key] !== tabGroup[key])) {
    return false;
  }

  return true;
}

export async function getUnpinnedAndUngroupedTabs(windowIdOrTabs: ChromeWindowId | ChromeTabWithId[]) {
  const { tabs } = await getWindowIdAndTabs(windowIdOrTabs);
  return tabs.filter((tab) => tab.groupId === chrome.tabGroups.TAB_GROUP_ID_NONE && !tab.pinned);
}

export async function groupUnpinnedAndUngroupedTabs(windowId: ChromeWindowId, tabs?: ChromeTabWithId[]) {
  const myLogger = logger.createNestedLogger("groupUnpinnedAndUngroupedTabs");
  try {
    const tabIdsWithNoGroup = (await getUnpinnedAndUngroupedTabs(tabs ?? windowId)).map((tab) => tab.id);
    if (tabIdsWithNoGroup.length === 0) {
      return;
    }

    const operationHandler = new ChromeTabOperationRetryHandler<ChromeTabGroupId, true>();
    operationHandler.setShouldRetryOperationCallback(async () => {
      const [windowUpToDate, tabsWithNoGroupUpToDate] = await Promise.all([
        getIfWindowExists(windowId),
        queryTabsIfWindowExists(windowId, { pinned: false, groupId: chrome.tabGroups.TAB_GROUP_ID_NONE }),
      ]);

      if (!windowUpToDate || !tabsWithNoGroupUpToDate || tabsWithNoGroupUpToDate.length === 0) {
        return false;
      }

      // Reset the operation for the tabs up-to-date
      const tabIdsWithNoGroupUpToDate = tabsWithNoGroupUpToDate.map((tab) => tab.id);
      operationHandler.replaceOperation(chrome.tabs.group({ createProperties: { windowId }, tabIds: tabIdsWithNoGroupUpToDate }));

      return true;
    });

    return await operationHandler.try(chrome.tabs.group({ createProperties: { windowId }, tabIds: tabIdsWithNoGroup }));
  } catch (error) {
    throw new Error(myLogger.getPrefixedMessage(Misc.getErrorMessage(error)));
  }
}

export function getTabTitleForUseTabTitle(tabsInGroup: ChromeTabWithId[]) {
  let candidateTab: ChromeTabWithId | undefined;
  tabsInGroup.forEach((tab) => {
    if (
      (!candidateTab ||
        (!candidateTab.active &&
          // prioritize by the active tab in it's window
          // FIXME: since the lastAccessed property is being compared, there is no need to check the tab.active property. However,
          //  we are currently doing so as a fallback for correctness due to the instability with the lastAccessed property.
          //  See https://issues.chromium.org/issues/326678907.
          (tab.active ||
            // then prioritize by lastAccessed
            (tab.lastAccessed && (!candidateTab.lastAccessed || tab.lastAccessed > candidateTab.lastAccessed)) ||
            // then prioritize by index if there is no lastAccessed on either tab
            (!candidateTab.lastAccessed && tab.index > candidateTab.index)))) &&
      tab.title &&
      tab.title.length > 0
    ) {
      candidateTab = tab;
    }
  });

  return candidateTab?.title;
}

export function isTabGroupTitleEmpty(title: chrome.tabGroups.TabGroup["title"]) {
  return title === undefined || title === "";
}

// TODO: use this where applicable
async function getWindowIdAndTabs(windowIdOrTabs: ChromeWindowId | ChromeTabWithId[]) {
  const windowId = Array.isArray(windowIdOrTabs) ? windowIdOrTabs[0]?.windowId : (windowIdOrTabs as ChromeWindowId | undefined);
  if (windowId === undefined) {
    return { windowId: chrome.windows.WINDOW_ID_NONE, tabs: [] };
  }

  const tabs = Array.isArray(windowIdOrTabs) ? (windowIdOrTabs as ChromeTabWithId[]) : ((await chrome.tabs.query({ windowId })) as ChromeTabWithId[]);
  return { windowId, tabs };
}

export async function focusActiveTab(
  tab: ChromeTabWithId,
  options: {
    collapseUnfocusedTabGroups: boolean;
    highlightColors?: {
      focused: chrome.tabGroups.ColorEnum;
      nonFocused: chrome.tabGroups.ColorEnum;
    };
  }
) {
  const { groupId: originalGroupId, windowId: originalWindowId } = tab;
  return await focusTabGroup<true>(originalGroupId, originalWindowId, options, async function shouldRetryCallAfterUserIsDoneTabDragging() {
    const [tabUpToDate, tabGroupUpToDate] = await Promise.all([
      getIfTabExists(tab.id),
      originalGroupId === chrome.tabGroups.TAB_GROUP_ID_NONE ? undefined : getIfTabGroupExists(originalGroupId),
    ]);
    return (
      !!tabUpToDate &&
      tabUpToDate.active &&
      tabUpToDate.windowId === originalWindowId &&
      tabUpToDate.groupId === originalGroupId &&
      (originalGroupId === chrome.tabGroups.TAB_GROUP_ID_NONE || !!tabGroupUpToDate)
    );
  });
}
