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

  const tabGroups = await ChromeWindowHelper.focusTabGroup(selectedTab.groupId, windowId, {
    collapseUnfocusedTabGroups: (await Storage.getItems("userPreferences")).userPreferences.collapseUnfocusedTabGroups,
    highlightColors: newFocusModeColors ?? undefined,
  });

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

export async function focusTab(windowId: ChromeWindowId, tabId: ChromeTabId) {
  const activeWindow = await getOrThrow(windowId);

  const tabs = (await chrome.tabs.query({ windowId })) as ChromeTabWithId[];
  const tab = tabs.find((tab) => tab.id === tabId);
  if (!tab) {
    throw new Error(`focusTab::tabId ${tabId} not found in windowId ${windowId}`);
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

  await ChromeWindowHelper.focusTabGroup(tab.groupId, windowId, {
    collapseUnfocusedTabGroups: (await getUserPreferences()).collapseUnfocusedTabGroups,
    highlightColors: activeWindow.focusMode?.colors,
  });
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
    color: tabGroup.color,
    collapsed: tabGroup.collapsed,
    ...otherProperties,
  } as Types.ActiveWindowTabGroup;

  if (tabGroup.title !== undefined) {
    activeWindowTabGroup.title = tabGroup.title;
  }

  return activeWindowTabGroup;
}
