import Types from "../types";
import {
  ChromeWindowWithId,
  ChromeWindowId,
  ChromeTabWithId,
  ChromeTabGroupWithId,
  ChromeTabId,
  ActiveWindow,
  ChromeTabGroupId,
} from "../types/types";
import Misc from "../misc";
import ChromeWindowHelper from "../chromeWindowHelper";
import Logger from "../logger";
import * as ActiveWindowDatabase from "./ActiveWindowDatabase";
import * as ActiveTabGroupDatabase from "./ActiveTabGroupDatabase";
import UserPreferences from "../userPreferences";
import Database from "../database";

const logger = Logger.getLogger("ActiveWindow", { color: "#b603fc" });

let activeWindows: Types.ActiveWindow[] = [];
let activeTabGroups: Types.ActiveTabGroup[] = [];

let windowsBeingActivated: ChromeWindowId[] = [];
let activatingAllWindows = false;
let reactivatingAllWindows = false;

let hasSyncedDatabase = false;
let hasSyncedDatabaseForStartingWindowId: ChromeWindowId | null = null;
let hasSyncedDatabaseForStartingTabGroupId: ChromeTabGroupId | null = null;
let isSyncingDatabase = false;
const startingWindowSyncing = new Misc.NonRejectablePromise<ChromeWindowId | null>();
const startingWindowSyncingPromise = startingWindowSyncing.getPromise();
const startingTabGroupSyncing = new Misc.NonRejectablePromise<ChromeTabGroupId | null>();
const startingTabGroupSyncingPromise = startingTabGroupSyncing.getPromise();
const remainingWindowsSyncing = new Misc.NonRejectablePromise<void>();
const remainingWindowsSyncingPromise = remainingWindowsSyncing.getPromise();

async function waitForSync(startingWindowId?: ChromeWindowId, startingTabGroupId?: ChromeTabGroupId) {
  return new Promise<void>(async (resolve, reject) => {
    try {
      if (hasSyncedDatabase) {
        resolve();
        return;
      }

      if (isSyncingDatabase) {
        const startingWindowSyncedId = await startingWindowSyncingPromise;
        const startingTabGroupSyncedId = await startingTabGroupSyncingPromise;
        if (startingWindowId === startingWindowSyncedId || startingTabGroupId === startingTabGroupSyncedId) {
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
      waitForSync(startingWindowId, startingTabGroupId).then(resolve, reject);

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

      // match and sync the starting active tab group
      let startingTabGroupSyncedId: Types.ActiveTabGroup["tabGroupId"] | null = null;
      if (startingTabGroupId !== undefined) {
        const startingPreviousActiveTabGroup = await ActiveTabGroupDatabase.get(startingTabGroupId);
        if (startingPreviousActiveTabGroup) {
          const startingTabGroupSynced = {
            tabGroupId: startingTabGroupId,
            windowId: startingPreviousActiveTabGroup.windowId,
            lastActiveTabId: startingPreviousActiveTabGroup.lastActiveTabId,
          } as Types.ActiveTabGroup;
          activeTabGroups.push(startingTabGroupSynced);
          startingTabGroupSyncedId = startingTabGroupSynced.tabGroupId;
        } else {
          logger.warn(`waitForSync::startingTabGroupId ${startingTabGroupId} not found in database`);
        }
      }
      hasSyncedDatabaseForStartingTabGroupId = startingTabGroupSyncedId;
      startingTabGroupSyncing.resolve(startingTabGroupSyncedId);

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

      // match and sync the remaining active tab groups
      const [tabGroups, previousActiveTabGroups] = await Promise.all([chrome.tabGroups.query({}), ActiveTabGroupDatabase.getAll()]);
      const remainingPreviousActiveTabGroups =
        startingTabGroupId !== undefined
          ? previousActiveTabGroups.filter((activeTabGroup) => activeTabGroup.tabGroupId !== startingTabGroupId)
          : previousActiveTabGroups;
      const remainingTabGroups = startingTabGroupId !== undefined ? tabGroups.filter((tabGroup) => tabGroup.id !== startingTabGroupId) : tabGroups;

      const nonMatchingActiveTabGroupIds: Types.ModelDataBaseActiveTabGroup["tabGroupId"][] = [];
      await Promise.all(
        remainingPreviousActiveTabGroups.map(async (activeTabGroup) => {
          const matchingTabGroup = remainingTabGroups.find((tabGroup) => tabGroup.id === activeTabGroup.tabGroupId);
          if (matchingTabGroup) {
            const activeTabGroupSynced = {
              tabGroupId: activeTabGroup.tabGroupId,
              // use the windowId from the matching tab group instead of the active tab group from the database
              //  because it could have been moved to another window
              windowId: matchingTabGroup.windowId,
              // check if the last active tab still exists because it could have been removed
              lastActiveTabId:
                activeTabGroup.lastActiveTabId !== null && (await ChromeWindowHelper.doesTabExist(activeTabGroup.lastActiveTabId))
                  ? activeTabGroup.lastActiveTabId
                  : null,
            } as Types.ActiveTabGroup;
            activeTabGroups.push(activeTabGroupSynced);
          } else {
            nonMatchingActiveTabGroupIds.push(activeTabGroup.tabGroupId);
          }
        })
      );

      if (nonMatchingActiveTabGroupIds.length > 0) {
        // FIXME: should the non-matching active tab groups be removed from the database?
        logger.warn(`waitForSync::nonMatchingActiveTabGroups:`, nonMatchingActiveTabGroupIds);
      }

      isSyncingDatabase = false;
      hasSyncedDatabase = true;
    } catch (error) {
      reject(`waitForSync::${error}`);
    }
  });
}

function throwIfNotSynced(methodName: string, startingWindowId?: ChromeWindowId, startingTabGroupId?: ChromeTabGroupId) {
  if (
    !hasSyncedDatabase &&
    hasSyncedDatabaseForStartingWindowId !== startingWindowId &&
    hasSyncedDatabaseForStartingTabGroupId !== startingTabGroupId
  ) {
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

function getActiveTabGroupInternal(windowId: ChromeWindowId, tabGroupId: ChromeTabGroupId) {
  throwIfNotSynced("getActiveTabGroupInternal", windowId, tabGroupId);
  return activeTabGroups.find((activeTabGroup) => activeTabGroup.windowId === windowId && activeTabGroup.tabGroupId === tabGroupId);
}

function getActiveTabGroupOrThrowInternal(windowId: ChromeWindowId, tabGroupId: ChromeTabGroupId) {
  throwIfNotSynced("getActiveTabGroupOrThrowInternal", windowId, tabGroupId);
  const activeTabGroup = getActiveTabGroupInternal(windowId, tabGroupId);
  if (!activeTabGroup) {
    throw new Error(`ActiveWindow::getActiveTabGroupOrThrowInternal with windowId ${windowId} and tabGroupId ${tabGroupId} not found`);
  }

  return activeTabGroup;
}

function addActiveTabGroupInternal(activeTabGroup: Types.ActiveTabGroup) {
  throwIfNotSynced("addActiveTabGroupInternal");
  const index = activeTabGroups.findIndex(
    (existingActiveTabGroup) =>
      existingActiveTabGroup.windowId === activeTabGroup.windowId && existingActiveTabGroup.tabGroupId === activeTabGroup.tabGroupId
  );
  if (index !== -1) {
    throw new Error(
      `ActiveWindow::active tab group with windowId ${activeTabGroup.windowId} and tabGroupId ${activeTabGroup.tabGroupId} already exists`
    );
  }
  activeTabGroups.push(activeTabGroup);
  ActiveTabGroupDatabase.add(activeTabGroup).catch((error) => {
    // TODO: bubble error up to global level
    logger.error(
      `addActiveTabGroupInternal::failed to add active tab group with windowId ${activeTabGroup.windowId} and tabGroupId ${activeTabGroup.tabGroupId} to database: ${error}`
    );
  });
}

function removeActiveTabGroupInternal(windowId: ChromeWindowId, tabGroupId: ChromeTabGroupId) {
  throwIfNotSynced("removeActiveTabGroupInternal", windowId, tabGroupId);
  const index = activeTabGroups.findIndex((activeTabGroup) => activeTabGroup.windowId === windowId && activeTabGroup.tabGroupId === tabGroupId);
  if (index === -1) {
    throw new Error(`ActiveWindow::removeActiveTabGroupInternal with windowId ${windowId} and tabGroupId ${tabGroupId} not found`);
  }

  activeTabGroups.splice(index, 1);
  ActiveTabGroupDatabase.remove(tabGroupId).catch((error) => {
    // TODO: bubble error up to global level
    logger.error(
      `removeActiveTabGroupInternal::failed to remove active tab group with windowId ${windowId} and tabGroupId ${tabGroupId} from database: ${error}`
    );
  });
}

function updateActiveTabGroupInternal(windowId: ChromeWindowId, tabGroupId: ChromeTabGroupId, updatedProperties: Partial<Types.ActiveTabGroup>) {
  throwIfNotSynced("updateActiveTabGroupInternal", windowId, tabGroupId);
  const activeTabGroup = getActiveTabGroupOrThrowInternal(windowId, tabGroupId);
  Object.assign(activeTabGroup, updatedProperties);
  ActiveTabGroupDatabase.update(tabGroupId, updatedProperties).catch((error) => {
    // TODO: bubble error up to global level
    logger.error(
      `updateActiveTabGroupInternal::failed to update active tab group with windowId ${windowId} and tabGroupId ${tabGroupId} in database: ${error}`
    );
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

export async function getActiveTabGroup(windowId: ChromeWindowId, tabGroupId: ChromeTabGroupId) {
  await waitForSync(windowId, tabGroupId);
  return getActiveTabGroupInternal(windowId, tabGroupId);
}

export async function getActiveTabGroupOrThrow(windowId: ChromeWindowId, tabGroupId: ChromeTabGroupId) {
  await waitForSync(windowId, tabGroupId);
  return getActiveTabGroupOrThrowInternal(windowId, tabGroupId);
}

export async function addActiveTabGroup(activeTabGroup: Types.ActiveTabGroup) {
  await waitForSync();
  return addActiveTabGroupInternal(activeTabGroup);
}

export async function removeActiveTabGroup(windowId: ChromeWindowId, tabGroupId: ChromeTabGroupId) {
  await waitForSync(windowId, tabGroupId);
  return removeActiveTabGroupInternal(windowId, tabGroupId);
}

export async function updateActiveTabGroup(windowId: ChromeWindowId, tabGroupId: ChromeTabGroupId, updatedProperties: Partial<Types.ActiveTabGroup>) {
  await waitForSync(windowId, tabGroupId);
  return updateActiveTabGroupInternal(windowId, tabGroupId, updatedProperties);
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
  activeTabGroups = [];

  const transaction = await Database.createTransaction<Types.ModelDataBase, ["activeWindows", "activeTabGroups"], "readwrite">(
    "model",
    ["activeWindows", "activeTabGroups"],
    "readwrite"
  );
  ActiveWindowDatabase.clear(transaction);
  ActiveTabGroupDatabase.clear(transaction);
  transaction.done.catch((error) => {
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
  if ((await UserPreferences.get()).collapseUnfocusedTabGroups) {
    await collapseUnFocusedTabGroups(tabGroups, selectedTab.groupId);
  }

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
  await Promise.all(
    tabGroups.map((tabGroup) =>
      addActiveTabGroup({ tabGroupId: tabGroup.id, windowId, lastActiveTabId: selectedTab.groupId === tabGroup.id ? selectedTab.id : null })
    )
  );

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

  const getUserPreferences = Misc.lazyCall(UserPreferences.get);

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
    // FIXME: remove the (t as any) cast when the chrome typings are updated to include the lastAccessed property
    const hasOpenedUnaccessedTabs = tabs.some((t) => t.openerTabId === tab.id && (t as any).lastAccessed === undefined && t.index > tab.index);
    if (tab.index < lastRelativeTabIndex && !hasOpenedUnaccessedTabs && (await getUserPreferences()).repositionTabs) {
      await ChromeWindowHelper.moveTab(tabId, { index: lastRelativeTabIndex });
    }
  }

  if ((await getUserPreferences()).collapseUnfocusedTabGroups) {
    await collapseUnFocusedTabGroups(windowId, tab.groupId);
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
