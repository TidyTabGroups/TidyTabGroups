import {
  ChromeWindowId,
  ChromeTabWithId,
  ChromeTabGroupWithId,
  ChromeTabId,
  ChromeTabGroupId,
  ChromeWindowWithId,
  FixedPageType,
  FocusTabGroupOptions,
} from "../Types/Types";
import Misc from "../Misc";
import ChromeTabOperationRetryHandler from "../ChromeTabOperationRetryHandler";
import Logger from "../Logger";

const logger = Logger.createLogger("chromeWindowHelper");

export async function activateTabWithRetryHandler(tabId: ChromeTabId) {
  const operationHandler = new ChromeTabOperationRetryHandler<ChromeTabWithId, true>();
  operationHandler.setShouldRetryOperationCallback(async () => {
    const activeTabUpToDate = await getIfTabExists(tabId);
    return !!activeTabUpToDate;
  });
  return await operationHandler.try(() => chrome.tabs.update(tabId, { active: true }) as Promise<ChromeTabWithId>);
}

export async function updateTabGroupWithRetryHandler(tabGroupId: ChromeTabGroupId, updatedProperties: chrome.tabGroups.UpdateProperties) {
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
  } catch (error) { }
}

export async function doesTabExist(tabId: ChromeTabId) {
  const tab = await getIfTabExists(tabId);
  return !!tab;
}

export async function getIfTabGroupExists(tabGroupId: ChromeTabGroupId) {
  try {
    return await chrome.tabGroups.get(tabGroupId);
  } catch (error) { }
}

export async function doesTabGroupExist(tabGroupId: ChromeTabGroupId) {
  const tabGroup = await getIfTabGroupExists(tabGroupId);
  return !!tabGroup;
}

export async function getIfWindowExists(windowId: ChromeWindowId, queryOptions: chrome.windows.QueryOptions = {}) {
  try {
    return (await chrome.windows.get(windowId, queryOptions)) as ChromeWindowWithId;
  } catch (error) { }
}
export async function getIfCurrentWindowExists() {
  try {
    return (await chrome.windows.getCurrent()) as ChromeWindowWithId;
  } catch (error) { }
}

export async function queryTabsIfWindowExists(windowId: ChromeWindowId, otherQueryInfo?: chrome.tabs.QueryInfo) {
  try {
    return (await chrome.tabs.query({ ...otherQueryInfo, windowId })) as ChromeTabWithId[];
  } catch (error) { }
}

export async function queryTabGroupsIfWindowExists(windowId: ChromeWindowId, otherQueryInfo?: chrome.tabGroups.QueryInfo) {
  try {
    return (await chrome.tabGroups.query({ ...otherQueryInfo, windowId })) as ChromeTabGroupWithId[];
  } catch (error) { }
}

export async function doesWindowExist(windowId: ChromeWindowId) {
  const window = await getIfWindowExists(windowId);
  return !!window;
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

function getLastAccessedOrGreatestIndexTabHelper(tabs: ChromeTabWithId[]) {
  let curr: ChromeTabWithId | undefined = tabs.find((tab) => tab.active);
  if (curr) {
    return curr;
  }

  tabs.forEach((tab) => {
    if (curr === undefined) {
      curr = tab;
      return;
    }

    if (tab.lastAccessed !== undefined) {
      if (curr.lastAccessed === undefined || tab.lastAccessed > curr.lastAccessed) {
        curr = tab;
      }
    } else if (curr.lastAccessed === undefined && tab.index > curr.index) {
      curr = tab;
    }
  });

  return curr;
}

export async function getLastAccessedOrGreatestIndexTabByGroupId(windowIdOrTabs: ChromeWindowId | ChromeTabWithId[]) {
  const windowIdAndTabs = await getWindowIdAndTabs(windowIdOrTabs);
  if (!windowIdAndTabs) {
    return {};
  }

  const { tabs } = windowIdAndTabs;
  const lastActiveTabByTagGroupId: { [tagGroupId: number]: ChromeTabWithId } = {};
  tabs.forEach((tab) => {
    const curr = lastActiveTabByTagGroupId[tab.groupId];
    if (!curr) {
      lastActiveTabByTagGroupId[tab.groupId] = tab;
      return;
    }

    const bestTab = getLastAccessedOrGreatestIndexTabHelper([curr, tab]) as ChromeTabWithId;
    lastActiveTabByTagGroupId[tab.groupId] = bestTab;
  });

  return lastActiveTabByTagGroupId;
}

export async function getLastAccessedOrGreatestIndexTab(windowIdOrTabs: ChromeWindowId | ChromeTabWithId[]) {
  const windowIdAndTabs = await getWindowIdAndTabs(windowIdOrTabs);
  if (!windowIdAndTabs) {
    return;
  }

  const { tabs } = windowIdAndTabs;
  return getLastAccessedOrGreatestIndexTabHelper(tabs);
}

export async function getTabsOrderedByLastAccessed(windowIdOrTabs: ChromeWindowId | ChromeTabWithId[]) {
  const windowIdAndTabs = await getWindowIdAndTabs(windowIdOrTabs);
  if (!windowIdAndTabs) {
    return [];
  }
  return windowIdAndTabs.tabs.sort((tab1, tab2) => (tab2.lastAccessed || 0) - (tab1.lastAccessed || 0));
}

export async function focusTabGroup(
  tabGroupId: ChromeTabGroupId,
  windowIdOrTabGroups: ChromeTabGroupWithId[] | ChromeWindowId,
  options: FocusTabGroupOptions
) {
  const windowIdAndTabGroups = await getWindowIdAndTabGroups(windowIdOrTabGroups);
  if (!windowIdAndTabGroups) {
    return [];
  }
  const { windowId, tabGroups } = windowIdAndTabGroups;
  const { collapseUnfocusedTabGroups, highlightColors, collapseIgnoreSet } = options;

  let prevActiveTabGroupToHighlightInfo: { id: ChromeTabGroupId; color: chrome.tabGroups.ColorEnum } | undefined;
  if (highlightColors?.highlightPrevActiveTabGroup && tabGroupId === chrome.tabGroups.TAB_GROUP_ID_NONE) {
    const prevActiveTabGroupId = await getLastAccessedTabGroupId(windowId);
    if (prevActiveTabGroupId !== undefined) {
      prevActiveTabGroupToHighlightInfo = {
        id: prevActiveTabGroupId,
        color: highlightColors.focused,
      };
    }
  }

  const updatedTabGroups = (await Promise.all(
    tabGroups.map(async (tabGroup) => {
      const updateProps: chrome.tabGroups.UpdateProperties = {};

      if (
        prevActiveTabGroupToHighlightInfo &&
        tabGroup.id === prevActiveTabGroupToHighlightInfo.id &&
        prevActiveTabGroupToHighlightInfo.color !== tabGroup.color
      ) {
        updateProps.color = prevActiveTabGroupToHighlightInfo.color;
      }

      if (tabGroup.id === tabGroupId) {
        if (tabGroup.collapsed) {
          updateProps.collapsed = false;
        }
        if (highlightColors?.focused && highlightColors.focused !== tabGroup.color) {
          updateProps.color = highlightColors.focused;
        }
      } else {
        const isInCollapseIgnoreSet = collapseIgnoreSet?.has(tabGroup.id);
        const isPrevActiveTabGroupToHighlight = tabGroup.id === prevActiveTabGroupToHighlightInfo?.id;

        if (collapseUnfocusedTabGroups && !tabGroup.collapsed && !isInCollapseIgnoreSet) {
          updateProps.collapsed = true;
        }
        if (highlightColors?.nonFocused && highlightColors.nonFocused !== tabGroup.color && !isPrevActiveTabGroupToHighlight) {
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

export const TAB_GROUP_COLORS: Array<chrome.tabGroups.ColorEnum> = ["grey", "blue", "red", "yellow", "green", "pink", "purple", "cyan", "orange"];

export async function getUnpinnedAndUngroupedTabs(windowIdOrTabs: ChromeWindowId | ChromeTabWithId[]) {
  const windowIdAndTabs = await getWindowIdAndTabs(windowIdOrTabs);
  if (!windowIdAndTabs) {
    return [];
  }
  return windowIdAndTabs.tabs.filter((tab) => tab.groupId === chrome.tabGroups.TAB_GROUP_ID_NONE && !tab.pinned);
}

export async function groupUnpinnedAndUngroupedTabsWithRetryHandler(windowIdOrTabs: ChromeWindowId | ChromeTabWithId[]) {
  const myLogger = logger.createNestedLogger("groupUnpinnedAndUngroupedTabsWithRetryHandler");
  try {
    const windowIdAndTabs = await getWindowIdAndTabs(windowIdOrTabs);
    if (!windowIdAndTabs) {
      return;
    }

    const { windowId, tabs } = windowIdAndTabs;
    const tabIdsWithNoGroup = (await getUnpinnedAndUngroupedTabs(tabs)).map((tab) => tab.id);
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

  // Remove leading digit in parentheses and any space characters after it from the tab title (e.g. "(7) Notion" -> "Notion")
  // TODO: add a user setting to toggle this behavior
  const LEADING_DIGIT_IN_PARENTHESES_REGEX = /^\(\d+\)\s*/;
  const cleanedTitle = candidateTab?.title ? candidateTab.title.replace(LEADING_DIGIT_IN_PARENTHESES_REGEX, "") : undefined;
  return cleanedTitle;
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

async function getWindowIdAndTabs(windowIdOrTabs: ChromeWindowId | ChromeTabWithId[]) {
  let windowId: ChromeWindowId;
  let tabs: ChromeTabWithId[];
  if (Array.isArray(windowIdOrTabs)) {
    if (windowIdOrTabs.length === 0) {
      return undefined;
    }

    windowId = windowIdOrTabs[0].windowId;
    tabs = windowIdOrTabs;
  } else {
    windowId = windowIdOrTabs;
    tabs = (await chrome.tabs.query({ windowId })) as ChromeTabWithId[];
  }

  return { windowId, tabs };
}

async function getWindowIdAndTabGroups(windowIdOrTabGroups: ChromeWindowId | ChromeTabGroupWithId[]) {
  let windowId: ChromeWindowId;
  let tabGroups: ChromeTabGroupWithId[];
  if (Array.isArray(windowIdOrTabGroups)) {
    if (windowIdOrTabGroups.length === 0) {
      return undefined;
    }

    windowId = windowIdOrTabGroups[0].windowId;
    tabGroups = windowIdOrTabGroups;
  } else {
    windowId = windowIdOrTabGroups;
    tabGroups = (await chrome.tabGroups.query({ windowId })) as ChromeTabGroupWithId[];
  }

  return { windowId, tabGroups };
}

export async function focusActiveTabWithRetryHandler(
  tabId: ChromeTabId,
  tabGroupId: ChromeTabGroupId,
  windowIdOrTabGroups: ChromeTabGroupWithId[] | ChromeWindowId,
  focusTabGroupOptions: FocusTabGroupOptions
) {
  const isTabGroupIdNone = tabGroupId === chrome.tabGroups.TAB_GROUP_ID_NONE;
  const windowIdAndTabGroups = await getWindowIdAndTabGroups(windowIdOrTabGroups);
  if (!windowIdAndTabGroups) {
    return [];
  }
  const { windowId, tabGroups } = windowIdAndTabGroups;

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
  windowIdOrTabGroups: ChromeTabGroupWithId[] | ChromeWindowId,
  options: FocusTabGroupOptions,
  fallback: boolean = false
) {
  const isTabGroupIdNone = tabGroupId === chrome.tabGroups.TAB_GROUP_ID_NONE;
  const windowIdAndTabGroups = await getWindowIdAndTabGroups(windowIdOrTabGroups);
  if (!windowIdAndTabGroups) {
    return [];
  }
  const { windowId, tabGroups } = windowIdAndTabGroups;

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

export async function createFixedPage<T extends FixedPageType>(
  type: T,
  url: string,
  windowId?: T extends "pinnedTab" | "tab" ? ChromeWindowId : undefined
) {
  const myLogger = logger.createNestedLogger("createFixedPage");
  try {
    if (type === "popupWindow") {
      const windows = await chrome.windows.getAll({ populate: true, windowTypes: ["popup"] });
      const existingPopupWindow = windows.find((window) => window.tabs && window.tabs[0] && window.tabs[0].url === url);
      if (existingPopupWindow) {
        return;
      }

      await chrome.windows.create({
        url: url,
        type: "popup",
        focused: false,
      });
    } else {
      let windows: ChromeWindowWithId[];
      if (windowId !== undefined) {
        const window = await getIfWindowExists(windowId, { populate: true, windowTypes: ["normal"] });
        if (!window) {
          throw new Error(`Normal window with id ${windowId} not found`);
        }
        windows = [window];
      } else {
        windows = (await chrome.windows.getAll({ populate: true })) as ChromeWindowWithId[];
      }

      await Promise.all(
        windows.map(async (window) => {
          if (window.id === undefined) {
            return;
          }

          const pinned = type === "pinnedTab";
          const existingTabs = await chrome.tabs.query({ windowId: window.id, url, pinned });
          if (existingTabs.length > 0) {
            return;
          }

          await chrome.tabs.create({ url, windowId: window.id, pinned, active: false, index: 0 });
        })
      );
    }
  } catch (error) {
    throw new Error(myLogger.getPrefixedMessage(Misc.getErrorMessage(error)));
  }
}

export async function getLastAccessedTabGroupId(windowIdOrTabs: ChromeWindowId | ChromeTabWithId[]) {
  const tabsOrderedByLastAccessed = await getTabsOrderedByLastAccessed(windowIdOrTabs);
  return tabsOrderedByLastAccessed.find((tab) => tab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE)?.groupId;
}
