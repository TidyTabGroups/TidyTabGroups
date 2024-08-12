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

export async function activateTabWithRetryHandler(tabId: ChromeTabId) {
  const operationHandler = new ChromeTabOperationRetryHandler<ChromeTabWithId, true>();
  operationHandler.setShouldRetryOperationCallback(async () => {
    const activeTabUpToDate = await getIfTabExists(tabId);
    return !!activeTabUpToDate;
  });
  return await operationHandler.try(() => chrome.tabs.update(tabId, { active: true }) as Promise<ChromeTabWithId>);
}

export async function updateTabGroupWithRetryHandler(tabGroupId: ChromeTabGroupId, updatedProperties: ChromeTabGroupUpdateProperties) {
  try {
    const operationHandler = new ChromeTabOperationRetryHandler<ChromeTabGroupWithId, true>();
    operationHandler.setShouldRetryOperationCallback(async () => {
      const tabGroupUpToDate = await getIfTabGroupExists(tabGroupId);
      return !!tabGroupUpToDate;
    });
    return await operationHandler.try(() => chrome.tabGroups.update(tabGroupId, updatedProperties));
  } catch (error) {
    // FIXME: remove this once saved tab groups are editable
    if (Misc.getErrorMessage(error).includes("saved groups are not editable")) {
      console.warn(`updateTabGroup::saved tab group with id ${tabGroupId} is not editable: `, error);
      return (await chrome.tabGroups.get(tabGroupId)) as ChromeTabGroupWithId;
    } else {
      throw error;
    }
  }
}

export async function moveTabWithRetryHandler(tabId: ChromeTabId, moveProperties: chrome.tabs.MoveProperties) {
  const windowIdToMoveTo = moveProperties.windowId || (await chrome.tabs.get(tabId)).windowId;

  const operationHandler = new ChromeTabOperationRetryHandler<ChromeTabWithId, true>();
  operationHandler.setShouldRetryOperationCallback(async () => {
    const [tabUpToDate, windowUpToDate] = await Promise.all([getIfTabExists(tabId), getIfWindowExists(windowIdToMoveTo)]);
    return !!tabUpToDate && !!windowUpToDate && tabUpToDate.windowId === windowIdToMoveTo;
  });

  return await operationHandler.try(() => chrome.tabs.move(tabId, moveProperties) as Promise<ChromeTabWithId>);
}

export async function moveTabGroupWithRetryHandler(tabGroupId: ChromeTabGroupId, moveProperties: chrome.tabGroups.MoveProperties) {
  const windowIdToMoveTo = moveProperties.windowId || (await chrome.tabGroups.get(tabGroupId)).windowId;

  const operationHandler = new ChromeTabOperationRetryHandler<ChromeTabGroupWithId, true>();
  operationHandler.setShouldRetryOperationCallback(async () => {
    const [tabGroupUpToDate, windowUpToDate] = await Promise.all([getIfTabGroupExists(tabGroupId), getIfWindowExists(windowIdToMoveTo)]);
    return !!tabGroupUpToDate && !!windowUpToDate && tabGroupUpToDate.windowId === windowIdToMoveTo;
  });
  return await operationHandler.try(() => chrome.tabGroups.move(tabGroupId, moveProperties) as Promise<ChromeTabGroupWithId>);
}

export async function groupTabsWithRetryHandler(options: chrome.tabs.GroupOptions) {
  const hasWindowIdToGroupIn = options.createProperties?.windowId !== undefined;
  const hasGroupIdToGroupIn = options.groupId !== undefined;

  const windowIdToGroupIn = options.createProperties?.windowId;
  const groupIdToGroupIn = options.groupId;

  if (!options.tabIds) {
    return;
  }

  const tabIds = Array.isArray(options.tabIds) ? options.tabIds : [options.tabIds];
  const operationHandler = new ChromeTabOperationRetryHandler<ChromeTabGroupId, true>();
  operationHandler.setShouldRetryOperationCallback(async () => {
    const [windowToGroupInExists, tabGroupToGroupInExists, tabsUpToDate] = await Promise.all([
      hasWindowIdToGroupIn ? doesWindowExist(windowIdToGroupIn!) : undefined,
      hasGroupIdToGroupIn ? doesTabGroupExist(groupIdToGroupIn!) : undefined,
      Promise.all(tabIds.map(getIfTabExists)),
    ]);

    const exisitingTabsUpToDate = tabsUpToDate.filter((tab) => !!tab) as ChromeTabWithId[];
    if ((hasWindowIdToGroupIn && !windowToGroupInExists) || (hasGroupIdToGroupIn && !tabGroupToGroupInExists) || exisitingTabsUpToDate.length === 0) {
      return false;
    }

    operationHandler.replaceOperation(() => chrome.tabs.group({ ...options, tabIds: exisitingTabsUpToDate.map((tab) => tab.id) }));
    return true;
  });

  return await operationHandler.try(() => chrome.tabs.group(options));
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

export async function queryTabGroupsIfWindowExists(windowId: ChromeWindowId, otherQueryInfo?: chrome.tabGroups.QueryInfo) {
  try {
    return (await chrome.tabGroups.query({ ...otherQueryInfo, windowId })) as ChromeTabGroupWithId[];
  } catch (error) {}
}

export async function doesWindowExist(windowId: ChromeWindowId) {
  const window = await getIfWindowExists(windowId);
  return !!window;
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
  const { tabGroups } = await getWindowIdAndTabGroups(tabGroupsOrWindowId);
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
        return await chrome.tabGroups.update(tabGroup.id, updateProps);
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

export async function groupUnpinnedAndUngroupedTabsWithRetryHandler(windowId: ChromeWindowId, tabs?: ChromeTabWithId[]) {
  const myLogger = logger.createNestedLogger("groupUnpinnedAndUngroupedTabsWithRetryHandler");
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
      operationHandler.replaceOperation(() => chrome.tabs.group({ createProperties: { windowId }, tabIds: tabIdsWithNoGroupUpToDate }));

      return true;
    });

    return await operationHandler.try(() => chrome.tabs.group({ createProperties: { windowId }, tabIds: tabIdsWithNoGroup }));
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

export async function withUserInteractionErrorHandler<T>(
  operation: () => Promise<T>
): Promise<{ result: T; encounteredUserInteractionError: false } | { result: undefined; encounteredUserInteractionError: true }> {
  try {
    return { result: await operation(), encounteredUserInteractionError: false };
  } catch (error) {
    if (Misc.getErrorMessage(error) !== "Tabs cannot be edited right now (user may be dragging a tab).") {
      throw error;
    }

    return { result: undefined, encounteredUserInteractionError: true };
  }
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

// TODO: use this where applicable
async function getWindowIdAndTabGroups(windowIdOrTabGroups: ChromeWindowId | ChromeTabGroupWithId[]) {
  const windowId = Array.isArray(windowIdOrTabGroups) ? windowIdOrTabGroups[0]?.windowId : (windowIdOrTabGroups as ChromeWindowId | undefined);
  if (windowId === undefined) {
    return { windowId: chrome.windows.WINDOW_ID_NONE, tabGroups: [] };
  }

  const tabGroups = Array.isArray(windowIdOrTabGroups)
    ? (windowIdOrTabGroups as ChromeTabGroupWithId[])
    : ((await chrome.tabGroups.query({ windowId })) as ChromeTabGroupWithId[]);
  return { windowId, tabGroups };
}

export async function focusActiveTabWithRetryHandler(
  tabId: ChromeTabId,
  tabGroupId: ChromeTabGroupId,
  tabGroupsOrWindowId: ChromeTabGroupWithId[] | ChromeWindowId,
  focusTabGroupOptions: {
    collapseUnfocusedTabGroups: boolean;
    highlightColors?: { focused: chrome.tabGroups.ColorEnum; nonFocused: chrome.tabGroups.ColorEnum };
  }
) {
  const isTabGroupIdNone = tabGroupId === chrome.tabGroups.TAB_GROUP_ID_NONE;
  const { windowId, tabGroups } = await getWindowIdAndTabGroups(tabGroupsOrWindowId);

  const operationHandler = new ChromeTabOperationRetryHandler<ChromeTabGroupWithId[], true>();
  operationHandler.setShouldRetryOperationCallback(async () => {
    const [tabUpToDate, tabGroupUpToDate] = await Promise.all([
      getIfTabExists(tabId),
      isTabGroupIdNone ? undefined : getIfTabGroupExists(tabGroupId),
    ]);

    return (
      tabUpToDate?.active === true &&
      tabUpToDate?.windowId === windowId &&
      tabUpToDate?.groupId === tabGroupId &&
      (isTabGroupIdNone || !!tabGroupUpToDate)
    );
  });

  return await operationHandler.try(() => focusTabGroup(tabGroupId, tabGroups, focusTabGroupOptions));
}

export async function focusTabGroupWithRetryHandler(
  tabGroupId: ChromeTabGroupId,
  tabGroupsOrWindowId: ChromeTabGroupWithId[] | ChromeWindowId,
  options: {
    collapseUnfocusedTabGroups: boolean;
    highlightColors?: { focused: chrome.tabGroups.ColorEnum; nonFocused: chrome.tabGroups.ColorEnum };
  },
  fallback: boolean = false
) {
  const isTabGroupIdNone = tabGroupId === chrome.tabGroups.TAB_GROUP_ID_NONE;
  const { windowId, tabGroups } = await getWindowIdAndTabGroups(tabGroupsOrWindowId);

  const operationHandler = new ChromeTabOperationRetryHandler<ChromeTabGroupWithId[], true>();
  operationHandler.setShouldRetryOperationCallback(async () => {
    const tabGroupsUpToDate = await queryTabGroupsIfWindowExists(windowId);
    if (!tabGroupsUpToDate) {
      return false;
    }

    let tabGroupIdToFocus = tabGroupId;
    if (!isTabGroupIdNone && !tabGroupsUpToDate.find((tabGroup) => tabGroup.id === tabGroupId)) {
      if (fallback) {
        tabGroupIdToFocus = chrome.tabGroups.TAB_GROUP_ID_NONE;
      } else {
        return false;
      }
    }

    operationHandler.replaceOperation(() => focusTabGroup(tabGroupIdToFocus, tabGroupsUpToDate, options));
    return true;
  });

  return await operationHandler.try(() => focusTabGroup(tabGroupId, tabGroups, options));
}

export async function groupTabAndHighlightedTabsWithRetryHandler(tabId: ChromeTabId) {
  const myLogger = logger.createNestedLogger("groupTabAndHighlightedTabsWithRetryHandler");

  const tab = (await chrome.tabs.get(tabId)) as ChromeTabWithId;
  if (tab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE || tab.pinned) {
    throw new Error(myLogger.getPrefixedMessage(`tab is already grouped or pinned - tabId: ${tabId}`));
  }

  const { windowId } = tab;
  let tabIdsToAutoGroup = [tabId];

  // If the tab is highlighted, auto-group it with all other ungrouped and highlighted tabs
  if (tab.highlighted) {
    // FIXME: if a non-grouped tab is active, and the user didnt explicitly ungroup it (e.g. by right-clicking and
    //  selecting "remove from group" on the tab of this event), it will be apart of highlightedTabs, which is undesired behavior.
    //  In order to fix this, we need to properly identify which other tabs the user explicitly ungrouped
    //  However, this scenerio is not actually possible on Chrome-like browsers, since the active tab is always the
    //  last highlighted tab, which means the user did explicitly highlight the tab before ungrouping it.
    const highlightedTabs = (await chrome.tabs.query({
      windowId: windowId,
      highlighted: true,
      groupId: chrome.tabGroups.TAB_GROUP_ID_NONE,
      pinned: false,
    })) as ChromeTabWithId[];

    if (highlightedTabs.find((highlightedTab) => highlightedTab.id === tabId)) {
      tabIdsToAutoGroup = highlightedTabs.map((highlightedTab) => highlightedTab.id);
    }
  }

  const operationHandler = new ChromeTabOperationRetryHandler<ChromeTabGroupId, true>();
  operationHandler.setShouldRetryOperationCallback(async () => {
    // Whatever happens to the up-to-date version of tabId in the retry callbacks is assumed
    //  to have happened to all the highlighted tabs.
    const tabUpToDate = await getIfTabExists(tabId);
    return (
      tabUpToDate !== undefined &&
      tabUpToDate.groupId === chrome.tabGroups.TAB_GROUP_ID_NONE &&
      !tabUpToDate.pinned &&
      tabUpToDate.windowId === windowId
    );
  });

  return await operationHandler.try(() => chrome.tabs.group({ createProperties: { windowId }, tabIds: tabIdsToAutoGroup }));
}
