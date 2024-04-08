import Database from "../database";
import Types from "../types";
import { ChromeWindowWithId, ChromeWindowId, ChromeTabWithId, ChromeTabGroupWithId, ChromeTabId, ActiveWindow } from "../types/types";
import Misc from "../misc";
import ChromeWindowHelper from "../chromeWindowHelper";
import Logger from "../logger";
import * as ActiveWindowDatabase from "./ActiveWindowDatabase";

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
          const startingWindowSynced = {
            windowId: startingWindowId,
            lastActiveTabInfo: startingPreviousActiveWindow?.lastActiveTabInfo ?? null,
          } as Types.ActiveWindow;
          activeWindows.push(startingWindowSynced);
          startingWindowSyncedId = startingWindowSynced.windowId;
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
          const activeWindowSynced = {
            windowId: activeWindow.windowId,
            lastActiveTabInfo: activeWindow.lastActiveTabInfo,
          } as Types.ActiveWindow;
          activeWindows.push(activeWindowSynced);
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
  ActiveWindowDatabase.add({ windowId: activeWindow.windowId, lastActiveTabInfo: activeWindow.lastActiveTabInfo }).catch((error) => {
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
  Object.assign(activeWindow, updatedProperties);
  // FIXME: pass in Partial<Types.ModelDataBaseActiveWindow> instead of Partial<Types.ActiveWindow>
  ActiveWindowDatabase.update(id, updatedProperties).catch((error) => {
    // TODO: bubble error up to global level
    logger.error(`updateInternal::failed to update active window with id ${id} in database: ${error}`);
  });
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

  reactivatingAllWindows = true;
  activeWindows = [];
  ActiveWindowDatabase.clear().catch((error) => {
    // TODO: bubble error up to global level
    logger.error(`reactivateAllWindows::failed to clear database: ${error}`);
  });

  try {
    await activateAllWindows();
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

async function activateWindowInternal(windowId: ChromeWindowId) {
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
  const tabGroups = await ChromeWindowHelper.getTabGroupsOrdered(tabs);

  // adjust the "shape" of the new active window, using the following adjustments:
  // 1. collapse all but the selected tab group
  // 2. un-collapse the selected tab group
  // 3. update the lastActiveTabInfo of the potential other active window with the same lastActiveTabInfo. This happens
  //    when a the last active tab of a window is moved to a new window

  // 1
  const remaingTabGroupsToCollapse = tabGroups.filter((tabGroup) => tabGroup.id !== selectedTab.groupId);
  const collapseNextTabGroup = async () => {
    const tabGroup = remaingTabGroupsToCollapse.pop();
    if (!tabGroup) {
      return;
    }

    if (!tabGroup.collapsed) {
      await ChromeWindowHelper.updateTabGroup(tabGroup.id, { collapsed: true });
    }
    await collapseNextTabGroup();
  };

  await collapseNextTabGroup();

  // 2
  const selectedTabGroup = tabGroups.find((tabGroup) => tabGroup.id === selectedTab.groupId);
  if (selectedTabGroup && selectedTabGroup.collapsed) {
    await ChromeWindowHelper.updateTabGroup(selectedTabGroup.id, { collapsed: false });
  }

  // 3
  const allActiveWindows = await getAll();
  const activeWindowWithSameLastActiveTabInfo = allActiveWindows.find((activeWindow) => activeWindow.lastActiveTabInfo.tabId === selectedTab.id);
  // check if the activeWindowWithSameLastActiveTabInfo still exists because it could have been removed, but its corresponding active window object not yet
  if (activeWindowWithSameLastActiveTabInfo && (await ChromeWindowHelper.doesWindowExist(activeWindowWithSameLastActiveTabInfo.windowId))) {
    const [activeTab] = (await chrome.tabs.query({ windowId: activeWindowWithSameLastActiveTabInfo.windowId, active: true })) as ChromeTabWithId[];
    Logger.attentionLogger.log(`activateWindowInternal::activeTab:`, activeTab);
    if (!activeTab) {
      throw new Error(
        `activateWindowInternal::activeWindowWithSameLastActiveTabInfo ${activeWindowWithSameLastActiveTabInfo.windowId} has no active tab`
      );
    }
    await update(activeWindowWithSameLastActiveTabInfo.windowId, {
      lastActiveTabInfo: { tabId: activeTab.id, tabGroupId: activeTab.groupId, title: activeTab.title },
    });
  }

  const newLastActiveTabInfo = { tabId: selectedTab.id, tabGroupId: selectedTab.groupId, title: selectedTab.title };
  await add({
    windowId,
    lastActiveTabInfo: newLastActiveTabInfo,
  });

  return tabGroups;
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

export async function setPrimaryTab(windowId: ChromeWindowId, tabId: ChromeTabId) {
  const tabs = (await chrome.tabs.query({ windowId })) as ChromeTabWithId[];
  const tab = tabs.find((tab) => tab.id === tabId);
  if (!tab) {
    throw new Error(`setPrimaryTab::tabId ${tabId} not found in windowId ${windowId}`);
  }

  let shouldMoveTab = false;
  if (!tab.pinned) {
    if (tab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE) {
      const tabsInGroup = tabs.filter((otherTab) => otherTab.groupId === tab.groupId);
      const lastTabInGroup = tabsInGroup[tabsInGroup.length - 1];
      if (lastTabInGroup.index < tabs[tabs.length - 1].index) {
        await ChromeWindowHelper.moveTabGroup(tab.groupId, { index: -1 });
      }

      if (tab.index < lastTabInGroup.index) {
        shouldMoveTab = true;
      }
    } else if (tab.index < tabs[tabs.length - 1].index) {
      shouldMoveTab = true;
    }

    // if the tab opened any un-accessed tabs that are positioned after it, then dont move it
    // FIXME: remove the (t as any) cast when the chrome typings are updated to include the lastAccessed property
    const hasOpenedUnaccessedTabs = tabs.some((t) => t.openerTabId === tab.id && (t as any).lastAccessed === undefined && t.index > tab.index);
    if (!hasOpenedUnaccessedTabs && shouldMoveTab) {
      await ChromeWindowHelper.moveTab(tabId, { index: -1 });
    }
  }

  const uncollapsedTabGroups = (await chrome.tabGroups.query({ windowId, collapsed: false })) as ChromeTabGroupWithId[];
  uncollapsedTabGroups.forEach(async (tabGroup) => {
    if (tabGroup.id !== tab.groupId) {
      await ChromeWindowHelper.updateTabGroup(tabGroup.id, { collapsed: true });
    }
  });
}
