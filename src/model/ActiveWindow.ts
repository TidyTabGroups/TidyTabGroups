import Types from "../types";
import {
  ChromeWindowWithId,
  ChromeWindowId,
  ChromeTabWithId,
  ChromeTabGroupWithId,
  ChromeTabId,
  ActiveWindow,
  ChromeTabGroupId,
  ActiveWindowFocusModeColors,
} from "../types/types";
import Misc from "../misc";
import ChromeWindowHelper from "../chromeWindowHelper";
import Logger from "../logger";
import * as ActiveWindowDatabase from "./ActiveWindowDatabase";
import * as Storage from "../storage";
import * as MouseInPageTracker from "../activeWindowManager/MouseInPageTracker";

const logger = Logger.getLogger("ActiveWindow", { color: "#b603fc" });

let activeWindows: Types.ActiveWindow[] = [];

let windowsBeingActivated: ChromeWindowId[] = [];
let activatingAllWindows = false;
let reactivatingAllWindows = false;

let hasSyncedDatabase = false;
let hasSyncedDatabaseForStartingWindowId: ChromeWindowId | null = null;
let isSyncingDatabase = false;
const startingWindowSyncing = new Misc.NonRejectablePromise<ChromeWindowId | null>();
const startingWindowSyncingPromise = startingWindowSyncing.getPromise();
const remainingWindowsSyncing = new Misc.NonRejectablePromise<void>();
const remainingWindowsSyncingPromise = remainingWindowsSyncing.getPromise();

async function waitForSync(startingWindowId?: ChromeWindowId) {
  return new Promise<void>(async (resolve, reject) => {
    try {
      if (hasSyncedDatabase) {
        resolve();
        return;
      }

      if (isSyncingDatabase) {
        const startingWindowSyncedId = await startingWindowSyncingPromise;
        if (startingWindowId === startingWindowSyncedId) {
          resolve();
          return;
        }

        await remainingWindowsSyncingPromise;
        resolve();
        return;
      }

      isSyncingDatabase = true;

      // calling waitForSync again after setting isSyncingDatabase
      //  to true will handle the resolution of this promise
      waitForSync(startingWindowId).then(resolve, reject);

      // match and sync the starting active window
      let startingWindowSyncedId: Types.ActiveWindow["windowId"] | null = null;
      if (startingWindowId !== undefined) {
        const startingPreviousActiveWindow = await ActiveWindowDatabase.get(startingWindowId);
        if (startingPreviousActiveWindow) {
          activeWindows.push(startingPreviousActiveWindow);
          startingWindowSyncedId = startingPreviousActiveWindow.windowId;
        } else {
          logger.warn(`waitForSync::startingWindowId ${startingWindowId} not found in database`);
        }
      }
      hasSyncedDatabaseForStartingWindowId = startingWindowSyncedId;
      startingWindowSyncing.resolve(startingWindowSyncedId);

      // match and sync the remaining active windows
      const [windows, previousActiveWindows] = await Promise.all([chrome.windows.getAll({ windowTypes: ["normal"] }), ActiveWindowDatabase.getAll()]);
      const remainingPreviousActiveWindows =
        startingWindowId !== undefined
          ? previousActiveWindows.filter((activeWindow) => activeWindow.windowId !== startingWindowId)
          : previousActiveWindows;
      const remainingWindows = startingWindowId !== undefined ? windows.filter((window) => window.id !== startingWindowId) : windows;
      const remainingWindowsIds = remainingWindows.map((window) => window.id);

      const nonMatchingActiveWindowIds: Types.ModelDataBaseActiveWindow["windowId"][] = [];
      remainingPreviousActiveWindows.forEach((activeWindow) => {
        if (remainingWindowsIds.includes(activeWindow.windowId)) {
          activeWindows.push(activeWindow);
        } else {
          nonMatchingActiveWindowIds.push(activeWindow.windowId);
        }
      });
      remainingWindowsSyncing.resolve();

      if (nonMatchingActiveWindowIds.length > 0) {
        // FIXME: should the non-matching active windows be removed from the database?
        logger.warn(`waitForSync::nonMatchingActiveWindows:`, nonMatchingActiveWindowIds);
      }

      isSyncingDatabase = false;
      hasSyncedDatabase = true;
    } catch (error) {
      reject(`waitForSync::${error}`);
    }
  });
}

function throwIfNotSynced(methodName: string, startingWindowId?: ChromeWindowId) {
  if (!hasSyncedDatabase && hasSyncedDatabaseForStartingWindowId !== startingWindowId) {
    throw new Error(
      `ActiveWindow::a read or write operation in ActiveWindow.${methodName} to the database copy has been made before it finished syncing`
    );
  }
}

function getOrThrowInternal(id: Types.ActiveWindow["windowId"]) {
  throwIfNotSynced("getOrThrowInternal", id);
  const activeWindow = getInternal(id);
  if (!activeWindow) {
    throw new Error(`ActiveWindow::getOrThrowInternal with id ${id} not found`);
  }

  return activeWindow;
}

function getInternal(id: Types.ActiveWindow["windowId"]) {
  throwIfNotSynced("getInternal", id);
  return activeWindows.find((activeWindow) => activeWindow.windowId === id);
}

function addInternal(activeWindow: Types.ActiveWindow) {
  throwIfNotSynced("addInternal");
  const index = activeWindows.findIndex((exisitingActiveWindow) => exisitingActiveWindow.windowId === activeWindow.windowId);
  if (index !== -1) {
    throw new Error(`ActiveWindow::active window with id ${activeWindow.windowId} already exists`);
  }
  activeWindows.push(activeWindow);
  ActiveWindowDatabase.add(activeWindow).catch((error) => {
    // TODO: bubble error up to global level
    logger.error(`addInternal::failed to add active window with id ${activeWindow.windowId} to database: ${error}`);
  });
}

function removeInternal(id: Types.ActiveWindow["windowId"]) {
  throwIfNotSynced("removeInternal", id);
  const index = activeWindows.findIndex((activeWindow) => activeWindow.windowId === id);
  if (index === -1) {
    throw new Error(`ActiveWindow::removeInternal with id ${id} not found`);
  }

  activeWindows.splice(index, 1);
  ActiveWindowDatabase.remove(id).catch((error) => {
    // TODO: bubble error up to global level
    logger.error(`removeInternal::failed to remove active window with id ${id} from database: ${error}`);
  });
}

function updateInternal(id: Types.ActiveWindow["windowId"], updatedProperties: Partial<Types.ActiveWindow>) {
  throwIfNotSynced("updateInternal", id);
  const activeWindow = getOrThrowInternal(id);
  const updatedActiveWindow = Object.assign(activeWindow, updatedProperties);
  // FIXME: pass in Partial<Types.ModelDataBaseActiveWindow> instead of Partial<Types.ActiveWindow>
  ActiveWindowDatabase.update(id, updatedProperties).catch((error) => {
    // TODO: bubble error up to global level
    logger.error(`updateInternal::failed to update active window with id ${id} in database: ${error}`);
  });
  return updatedActiveWindow as Types.ActiveWindow;
}

export async function getOrThrow(id: Types.ActiveWindow["windowId"]) {
  await waitForSync(id);
  return getOrThrowInternal(id);
}

export async function get(id: Types.ActiveWindow["windowId"]) {
  await waitForSync(id);
  return getInternal(id);
}

export async function getAll() {
  await waitForSync();
  return activeWindows;
}

export async function add(activeWindow: Types.ActiveWindow) {
  await waitForSync();
  return addInternal(activeWindow);
}

export async function remove(id: Types.ActiveWindow["windowId"]) {
  await waitForSync(id);
  return removeInternal(id);
}

export async function update(id: Types.ActiveWindow["windowId"], updatedProperties: Partial<Types.ActiveWindow>) {
  await waitForSync(id);
  return updateInternal(id, updatedProperties);
}

export function isActivatingAllWindows() {
  return activatingAllWindows;
}

export function isReactivatingAllWindows() {
  return reactivatingAllWindows;
}

export function isActivatingOrReactivatingAllWindows() {
  return isActivatingAllWindows() || isReactivatingAllWindows();
}

export function isActivatingWindow(windowId: ChromeWindowId) {
  return isActivatingAllWindows() || windowIsBeingActivated(windowId);
}

export function isActivatingAnyWindow() {
  return isActivatingAllWindows() || windowsBeingActivated.length > 0;
}

export function windowIsBeingActivated(windowId: ChromeWindowId) {
  return windowsBeingActivated.includes(windowId);
}

export function getWindowsBeingActivated() {
  return windowsBeingActivated;
}

export async function reactivateAllWindows() {
  if (isReactivatingAllWindows() || isActivatingAnyWindow()) {
    throw new Error("reactivateAllWindows::already re-activating all windows, or another window is being activated");
  }

  try {
    reactivatingAllWindows = true;

    const [windows, previousActiveWindows] = await Promise.all([chrome.windows.getAll() as Promise<ChromeWindowWithId[]>, getAll()]);
    const windowIds = windows.map((window) => window.id);

    activeWindows = [];
    ActiveWindowDatabase.clear().catch((error) => {
      // TODO: bubble error up to global level
      logger.error(`reactivateAllWindows::failed to clear database: ${error}`);
    });

    await Promise.all(
      windowIds.map(async (windowId) => {
        const previousActiveWindow = previousActiveWindows.find((previousActiveWindow) => previousActiveWindow.windowId === windowId);
        await activateWindowInternal(windowId, previousActiveWindow?.focusMode?.colors);
      })
    );
  } catch (error) {
    throw new Error(`reactivateAllWindows::${error}`);
  } finally {
    reactivatingAllWindows = false;
  }
}

export async function activateAllWindows() {
  if (isActivatingAnyWindow()) {
    throw new Error("activateAllWindows::a window is already being activated");
  }

  activatingAllWindows = true;

  try {
    const windows = (await chrome.windows.getAll()) as ChromeWindowWithId[];
    await Promise.all(windows.map((window) => activateWindowInternal(window.id)));
  } catch (error) {
    throw new Error(`activateAllWindows::${error}`);
  } finally {
    activatingAllWindows = false;
  }
}

async function activateWindowInternal(windowId: ChromeWindowId, focusModeColors?: ActiveWindowFocusModeColors) {
  const window = (await chrome.windows.get(windowId)) as ChromeWindowWithId;
  if (!window) {
    throw new Error(`activateWindow::window with id ${window} not found`);
  }

  if (window.type !== "normal") {
    throw new Error(`activateWindow::window with id ${window} is not a normal window`);
  }

  const tabs = (await chrome.tabs.query({ windowId })) as ChromeTabWithId[];
  const selectedTab = tabs.find((tab) => tab.active);
  if (!selectedTab) {
    throw new Error(`activateWindow::window with id ${windowId} has no active tab`);
  }

  let newFocusModeColors: ActiveWindowFocusModeColors | null = null;
  if (focusModeColors) {
    newFocusModeColors = focusModeColors;
  } else {
    const { lastSeenFocusModeColors, lastFocusedWindowHadFocusMode } = await Storage.getItems([
      "lastSeenFocusModeColors",
      "lastFocusedWindowHadFocusMode",
    ]);
    newFocusModeColors = lastFocusedWindowHadFocusMode ? lastSeenFocusModeColors : null;
  }

  if (window.focused && newFocusModeColors) {
    await Storage.setItems({ lastSeenFocusModeColors: newFocusModeColors, lastFocusedWindowHadFocusMode: true });
  }

  // TODO: check for `automatically group created tabs` user preference
  let useTabTitleForGroupId: ChromeTabGroupId | null = null;
  if (tabs.length === 1 && selectedTab.groupId === chrome.tabGroups.TAB_GROUP_ID_NONE) {
    const newGroupId = await ChromeWindowHelper.groupTabs({ createProperties: { windowId }, tabIds: selectedTab.id });
    selectedTab.groupId = newGroupId;
    // TODO: check for `use tab title for blank tab groups` user preference
    useTabTitleForGroupId = newGroupId;
  }

  await ChromeWindowHelper.focusTabGroup(selectedTab.groupId, windowId, {
    collapseUnfocusedTabGroups: (await Storage.getItems("userPreferences")).userPreferences.collapseUnfocusedTabGroups,
    highlightColors: newFocusModeColors ?? undefined,
  });

  const tabGroups = (await chrome.tabGroups.query({ windowId })) as ChromeTabGroupWithId[];
  let newFocusMode = newFocusModeColors
    ? {
        colors: newFocusModeColors,
        savedTabGroupColors: tabGroups.map((tabGroup) => ({ tabGroupId: tabGroup.id, color: tabGroup.color })),
      }
    : null;
  const newActiveWindow = {
    windowId,
    focusMode: newFocusMode,
    // TODO: need to allow the caller to pass in other ActiveWindowTabGroup properties like useTabTitle
    tabGroups: tabGroups.map((tabGroup) => {
      return chromeTabGroupToActiveWindowTabGroup(tabGroup, { useTabTitle: tabGroup.id === useTabTitleForGroupId });
    }),
  } as Types.ActiveWindow;

  await add(newActiveWindow);
  return newActiveWindow;
}

export async function activateWindow(windowId: ChromeWindowId) {
  if (isActivatingWindow(windowId)) {
    throw new Error(`activateWindow::windowId ${windowId} is already being activated`);
  }

  windowsBeingActivated.push(windowId);

  try {
    await activateWindowInternal(windowId);
  } catch (error) {
    throw new Error(`activateWindow::${error}`);
  } finally {
    windowsBeingActivated = windowsBeingActivated.filter((id) => id !== windowId);
  }
}

export async function deactivateWindow(windowId: ChromeWindowId) {
  if (isActivatingWindow(windowId)) {
    throw new Error(`deactivateWindow::windowId ${windowId} is being activated`);
  }
  const activeWindow = await get(windowId);
  if (!activeWindow) {
    throw new Error(`deactivateWindow::windowId ${windowId} not found`);
  }

  await remove(windowId);
}

export async function getPrimaryTabGroup(windowId: ChromeWindowId) {
  const tabGroupsOrdered = await ChromeWindowHelper.getTabGroupsOrdered(windowId);
  return tabGroupsOrdered.length > 0 ? tabGroupsOrdered[tabGroupsOrdered.length - 1] : null;
}

export async function repositionTab(windowId: ChromeWindowId, tabId: ChromeTabId) {
  const activeWindow = await getOrThrow(windowId);

  const tabs = (await chrome.tabs.query({ windowId })) as ChromeTabWithId[];
  const tab = tabs.find((tab) => tab.id === tabId);
  if (!tab) {
    throw new Error(`repositionTab::tabId ${tabId} not found in windowId ${windowId}`);
  }

  const getUserPreferences = Misc.lazyCall(async () => {
    return (await Storage.getItems("userPreferences")).userPreferences;
  });

  if (!tab.pinned) {
    // if the tab is in a tab group, lastRelativeTabIndex will be the last tab in the group, otherwise it will be the last tab in the window
    let lastRelativeTabIndex = tabs[tabs.length - 1].index;

    // reposition the tab's group to the end
    if (tab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE) {
      const tabsInGroup = tabs.filter((otherTab) => otherTab.groupId === tab.groupId);
      const lastTabInGroup = tabsInGroup[tabsInGroup.length - 1];
      if (lastTabInGroup.index < tabs[tabs.length - 1].index && (await getUserPreferences()).repositionTabGroups) {
        await ChromeWindowHelper.moveTabGroup(tab.groupId, { index: -1 });
      } else {
        lastRelativeTabIndex = lastTabInGroup.index;
      }
    }

    // reposition the tab to the end
    // if the tab opened any un-accessed tabs that are positioned after it, then dont move it
    const hasOpenedUnaccessedTabs = tabs.some((t) => t.openerTabId === tab.id && t.lastAccessed === undefined && t.index > tab.index);
    if (tab.index < lastRelativeTabIndex && !hasOpenedUnaccessedTabs && (await getUserPreferences()).repositionTabs) {
      await ChromeWindowHelper.moveTab(tabId, { index: lastRelativeTabIndex });
    }
  }
}

export async function collapseUnFocusedTabGroups(tabGroupsOrWindowId: ChromeTabGroupWithId[] | ChromeWindowId, focusedTabGroupId: ChromeTabGroupId) {
  let tabGroups: ChromeTabGroupWithId[];
  if (typeof tabGroupsOrWindowId === "number") {
    tabGroups = (await chrome.tabGroups.query({ windowId: tabGroupsOrWindowId, collapsed: false })) as ChromeTabGroupWithId[];
  } else {
    tabGroups = tabGroupsOrWindowId.filter((tabGroup) => !tabGroup.collapsed);
  }

  const unfocusedTabGroups = tabGroups.filter((tabGroup) => tabGroup.id !== focusedTabGroupId);
  await Promise.all(
    unfocusedTabGroups.map(async (unfocusedTabGroup) => {
      await ChromeWindowHelper.updateTabGroup(unfocusedTabGroup.id, { collapsed: true });
    })
  );
}

export function chromeTabGroupToActiveWindowTabGroup(
  tabGroup: chrome.tabGroups.TabGroup,
  otherProperties?: { useTabTitle: Types.ActiveWindowTabGroup["useTabTitle"] }
) {
  const activeWindowTabGroup = {
    id: tabGroup.id,
    windowId: tabGroup.windowId,
    color: tabGroup.color,
    collapsed: tabGroup.collapsed,
    ...otherProperties,
  } as Types.ActiveWindowTabGroup;

  if (tabGroup.title !== undefined) {
    activeWindowTabGroup.title = tabGroup.title;
  }

  return activeWindowTabGroup;
}

export async function getActiveWindowTabGroup(windowId: ChromeWindowId, tabGroupId: ChromeTabGroupId) {
  return (await getOrThrow(windowId)).tabGroups.find((tabGroup) => tabGroup.id === tabGroupId);
}

export async function getActiveWindowTabGroupOrThrow(windowId: ChromeWindowId, tabGroupId: ChromeTabGroupId) {
  const activeWindowTabGroup = await getActiveWindowTabGroup(windowId, tabGroupId);
  if (!activeWindowTabGroup) {
    throw new Error(`getActiveWindowTabGroupOrThrow::tabGroupId ${tabGroupId} not found in windowId ${windowId}`);
  }

  return activeWindowTabGroup;
}

export async function updateActiveWindowTabGroup(
  windowId: ChromeWindowId,
  tabGroupId: ChromeTabGroupId,
  updateProps: Partial<Types.ActiveWindowTabGroup> = {}
) {
  const activeWindowTabGroups = (await get(windowId))?.tabGroups;
  if (activeWindowTabGroups === undefined) {
    throw new Error(`updateActiveWindowTabGroup::windowId ${windowId} not found`);
  }

  let updatedTabGroup: Types.ActiveWindowTabGroup | null = null;
  const activeWindow = await update(windowId, {
    tabGroups: activeWindowTabGroups.map((otherTabGroup) => {
      if (otherTabGroup.id === tabGroupId) {
        updatedTabGroup = Object.assign(otherTabGroup, updateProps);
        return updatedTabGroup;
      }
      return otherTabGroup;
    }),
  });

  if (updatedTabGroup === null) {
    throw new Error(`updateActiveWindowTabGroup::tabGroupId ${tabGroupId} not found in windowId ${windowId}`);
  }

  return activeWindow;
}

export async function updateActiveWindowTabGroups(
  windowId: ChromeWindowId,
  updatePropsList: ({ id: Types.ActiveWindowTabGroup["id"] } & Partial<Types.ActiveWindowTabGroup>)[]
) {
  const activeWindowTabGroups = (await get(windowId))?.tabGroups;
  if (activeWindowTabGroups === undefined) {
    throw new Error(`updateActiveWindowTabGroups::windowId ${windowId} not found`);
  }

  const updatedTabGroups: Types.ActiveWindowTabGroup[] = [];
  const newActiveWindowTabGroups = activeWindowTabGroups.map((otherTabGroup) => {
    const updateProps = updatePropsList.find((updateProps) => updateProps.id === otherTabGroup.id);
    if (updateProps !== undefined) {
      const updatedTabGroup = Object.assign(otherTabGroup, updateProps);
      updatedTabGroups.push(updatedTabGroup);
      return updatedTabGroup;
    }
    return otherTabGroup;
  });

  if (updatedTabGroups.length !== updatePropsList.length) {
    const notUpdatedTabGroupIds = updatePropsList
      .map((updateProps) => updateProps.id)
      .filter((id) => !activeWindowTabGroups.find((tabGroup) => tabGroup.id === id));
    throw new Error(`updateActiveWindowTabGroups::tabGroupIds ${notUpdatedTabGroupIds} not found in windowId ${windowId}`);
  }

  return await update(windowId, { tabGroups: newActiveWindowTabGroups });
}

export async function createActiveWindowTabGroup(windowId: ChromeWindowId, tabGroup: ChromeTabGroupWithId) {
  const myLogger = logger.getNestedLogger("createActiveWindowTabGroup");
  try {
    const activeWindow = await getOrThrow(windowId);
    let newActiveWindowTabGroup = { ...tabGroup, useTabTitle: false };

    const activeTab = (await chrome.tabs.query({ windowId: tabGroup.windowId, active: true }))[0] as ChromeTabWithId | undefined;
    let tabGroupUpToDate: ChromeTabGroupWithId | undefined = tabGroup;

    // 1
    const isFocusedTabGroup = activeTab && activeTab.groupId === tabGroup.id;
    const { focusMode } = activeWindow;
    if (focusMode) {
      if (isFocusedTabGroup && focusMode.colors.focused !== tabGroupUpToDate.color) {
        tabGroupUpToDate = await ChromeWindowHelper.updateTabGroup(tabGroup.id, { color: focusMode.colors.focused });
      } else if (!isFocusedTabGroup && focusMode.colors.nonFocused !== tabGroupUpToDate.color) {
        tabGroupUpToDate = await ChromeWindowHelper.updateTabGroup(tabGroup.id, { color: focusMode.colors.nonFocused });
      }
      newActiveWindowTabGroup.color = tabGroupUpToDate.color;
    }

    // 2
    // TODO: check for `use tab title for blank tab groups` user preference
    const useTabTitle = tabGroupUpToDate.title === undefined || tabGroupUpToDate.title === "";
    if (useTabTitle) {
      // FIXME: remove the timeout workaround once the chromium bug is resolved: https://issues.chromium.org/issues/334965868#comment4
      await Misc.waitMs(30);

      const tabsInGroup = (await chrome.tabs.query({ windowId: tabGroup.windowId, groupId: tabGroup.id })) as ChromeTabWithId[];
      const newTitle = getTabTitleForUseTabTitle(tabsInGroup) ?? Misc.DEFAULT_TAB_GROUP_TITLE;

      tabGroupUpToDate = await ChromeWindowHelper.getIfTabGroupExists(tabGroup.id);
      if (!tabGroupUpToDate) {
        myLogger.warn(`(2) tabGroupUpToDate not found for tabGroup:${tabGroup.id}`);
        return;
      }

      if (tabGroupUpToDate.title === undefined || tabGroupUpToDate.title === "") {
        tabGroupUpToDate = await ChromeWindowHelper.updateTabGroup(tabGroup.id, { title: newTitle });
        newActiveWindowTabGroup = { ...newActiveWindowTabGroup, title: tabGroupUpToDate.title, useTabTitle: true };
      }
    }

    // 3
    await update(activeWindow.windowId, {
      tabGroups: [...activeWindow.tabGroups, newActiveWindowTabGroup],
    });
  } catch (error) {
    throw new Error(myLogger.getPrefixedMessage(`error:${error}`));
  }
}

export async function focusActiveTab(tab: ChromeTabWithId) {
  const activeWindow = await getOrThrow(tab.windowId);
  const { groupId: originalGroupId, windowId: originalWindowId } = tab;
  const tabGroupsUpToDate = await ChromeWindowHelper.focusTabGroup<true>(
    originalGroupId,
    originalWindowId,
    {
      collapseUnfocusedTabGroups: (await Storage.getItems("userPreferences")).userPreferences.collapseUnfocusedTabGroups,
      highlightColors: activeWindow.focusMode?.colors,
    },
    async function shouldRetryCallAfterUserIsDoneTabDragging() {
      const [tabUpToDate, tabGroupUpToDate] = await Promise.all([
        ChromeWindowHelper.getIfTabExists(tab.id),
        originalGroupId === chrome.tabGroups.TAB_GROUP_ID_NONE ? undefined : ChromeWindowHelper.getIfTabGroupExists(originalGroupId),
      ]);
      return (
        !!tabUpToDate &&
        tabUpToDate.active &&
        tabUpToDate.windowId === originalWindowId &&
        tabUpToDate.groupId === originalGroupId &&
        (originalGroupId === chrome.tabGroups.TAB_GROUP_ID_NONE || !!tabGroupUpToDate)
      );
    }
  );

  const tabGroupsUpToDateById: { [tabGroupId: ChromeTabGroupId]: ChromeTabGroupWithId } = (tabGroupsUpToDate as ChromeTabGroupWithId[]).reduce(
    (acc, tabGroup) => ({ ...acc, [tabGroup.id]: tabGroup }),
    {}
  );

  const newActiveWindowTabGroups = activeWindow.tabGroups.map((activeWindowTabGroup) => {
    if (tabGroupsUpToDateById[activeWindowTabGroup.id]) {
      return {
        ...activeWindowTabGroup,
        collapsed: tabGroupsUpToDateById[activeWindowTabGroup.id].collapsed,
        color: tabGroupsUpToDateById[activeWindowTabGroup.id].color,
      };
    }
    return activeWindowTabGroup;
  });
  await update(activeWindow.windowId, { tabGroups: newActiveWindowTabGroups });
}

export async function groupHighlightedTabs(windowId: ChromeWindowId, tabIds: ChromeTabId[]) {
  const myLogger = logger.getNestedLogger("groupHighlightedTabs");
  try {
    // whatever happens to the up-to-date version of tabId in the retry callbacks is assumed
    //  to have happened to all the highlighted tabs.
    const tabId = tabIds[0];
    if (tabId === undefined) {
      return;
    }

    const newGroupId = await (async function groupTabsRec(windowId: ChromeWindowId) {
      return new Promise<ChromeTabGroupId | void>(async (resolve, reject) => {
        try {
          resolve(
            await ChromeWindowHelper.groupTabs<true>(
              {
                createProperties: { windowId },
                tabIds,
              },
              async function shouldRetryCallAfterUserIsDoneTabDragging() {
                const tabUpToDate = await ChromeWindowHelper.getIfTabExists(tabId);

                if (!tabUpToDate) {
                  return false;
                }

                if (tabUpToDate.windowId !== windowId) {
                  // FIXME: if the tab was moved to a non-active window, then moved to an active window,
                  //  the grouping operation will not be retried, which is not correct behavior. This is a limitation
                  //  of the retry mechanism
                  if (await get(tabUpToDate.windowId)) {
                    resolve(await groupTabsRec(tabUpToDate.windowId));
                  }
                  return false;
                }

                return tabUpToDate.groupId === chrome.tabGroups.TAB_GROUP_ID_NONE;
              }
            )
          );
        } catch (error) {
          reject(error);
        }
      });
    })(windowId);

    if (newGroupId) {
      const newTabGroup = await ChromeWindowHelper.getIfTabGroupExists(newGroupId);
      if (!newTabGroup) {
        throw new Error(myLogger.getPrefixedMessage(`newTabGroup not found - newGroupId: ${newGroupId}`));
      }

      // use try catch just for more descriptive error message
      try {
        await createActiveWindowTabGroup(newTabGroup.windowId, newTabGroup);
      } catch (error) {
        throw new Error(myLogger.getPrefixedMessage(`createActiveWindowTabGroup::${error}`));
      }
    }
    return newGroupId;
  } catch (error) {
    throw new Error(myLogger.getPrefixedMessage(`error:${error}`));
  }
}

export async function useTabTitleForEligebleTabGroups() {
  const myLogger = logger.getNestedLogger("autoNameAllTabGroups");
  try {
    const [activeWindows, windows] = await Promise.all([
      getAll(),
      chrome.windows.getAll({ windowTypes: ["normal"], populate: true }) as Promise<(ChromeWindowWithId & { tabs: ChromeTabWithId[] })[]>,
    ]);
    const activeWindowsSet = new Set(activeWindows.map((activeWindow) => activeWindow.windowId));
    const mouseInPage = MouseInPageTracker.isInPage();

    await Promise.all(
      windows.map(async (window) => {
        if (!activeWindowsSet.has(window.id) || (!mouseInPage && window.focused)) {
          return;
        }

        const tabsByGroupId = (window.tabs as ChromeTabWithId[]).reduce((acc, tab) => {
          if (tab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE) {
            acc[tab.groupId] = acc[tab.groupId] || [];
            acc[tab.groupId].push(tab);
          }
          return acc;
        }, {} as { [groupId: number]: ChromeTabWithId[] });

        await Promise.all(
          Object.entries(tabsByGroupId).map(async ([groupId, tabsInGroup]) => {
            const tabTitle = getTabTitleForUseTabTitle(tabsInGroup);
            if (tabTitle) {
              const activeWindowTabGroup = await getActiveWindowTabGroup(window.id, parseInt(groupId));
              if (!activeWindowTabGroup) {
                return;
              }

              if (activeWindowTabGroup.useTabTitle && activeWindowTabGroup.title !== tabTitle) {
                const updatedTabGroup = await ChromeWindowHelper.updateTabGroup(activeWindowTabGroup.id, { title: tabTitle });
                await updateActiveWindowTabGroup(updatedTabGroup.windowId, updatedTabGroup.id, { title: updatedTabGroup.title });
              }
            }
          })
        );
      })
    );
  } catch (error) {
    throw new Error(myLogger.getPrefixedMessage(`error:${error}`));
  }
}

function getTabTitleForUseTabTitle(tabsInGroup: ChromeTabWithId[]) {
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
