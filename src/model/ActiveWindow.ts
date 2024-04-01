import Database from "../database";
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
            primaryTabActivationInfo: null,
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
            primaryTabActivationInfo: null,
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
  // 1. blur all but the selected tab group
  // 2. expand and highlight the selected tab group

  // 1
  await blurAllTabGroupsExcept(windowId, selectedTab.groupId, tabGroups);

  const selectedTabGroup = tabGroups.find((tabGroup) => tabGroup.id === selectedTab.groupId);
  if (selectedTabGroup) {
    await expandAndHighlightTabGroup(selectedTabGroup);
  }

  const newLastActiveTabInfo = { tabId: selectedTab.id, tabGroupId: selectedTab.groupId, title: selectedTab.title };
  await add({
    windowId,
    lastActiveTabInfo: newLastActiveTabInfo,
    primaryTabActivationInfo: null,
  });

  await startPrimaryTabActivation(selectedTab.windowId, selectedTab.id);

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

  await clearPrimaryTabActivation(windowId);
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
        await ChromeWindowHelper.moveTabGroupAndWait(tab.groupId, { index: -1 });
      }

      if (tab.index < lastTabInGroup.index) {
        shouldMoveTab = true;
      }
    } else if (tab.index < tabs[tabs.length - 1].index) {
      shouldMoveTab = true;
    }
  }

  if (shouldMoveTab) {
    await ChromeWindowHelper.moveTabAndWait(tabId, { index: -1 });
  }

  await blurAllTabGroupsExcept(windowId, tab.groupId);
}

export async function startPrimaryTabActivation(windowId: ChromeWindowId, tabOrTabId: ChromeTabId | ChromeTabWithId) {
  const tabId = typeof tabOrTabId === "number" ? tabOrTabId : tabOrTabId.id;
  logger.log(`startPrimaryTabActivation::windowId: ${windowId}, tabId: ${tabId}`);

  const activeWindow = await getOrThrow(windowId);
  if (activeWindow.primaryTabActivationInfo !== null) {
    throw new Error(
      `startPrimaryTabActivation::windowId ${windowId} already has a primaryTabActivationInfo. If you want to restart the timeout, use restartPrimaryTabActivationTimeout instead. Otherwsie clear the timeout first`
    );
  }

  const tab = await Misc.getTabFromTabOrTabId(tabOrTabId);
  if (!tab) {
    logger.warn(`startPrimaryTabActivation::tabId ${tabId} not found`);
    return;
  }

  const primaryTabActivationTimeoutPeriods = {
    NON_SCRIPTABLE_TAB: 6500,
    SCRIPTABLE_TAB: 15000,
  };

  // Start the primary tab activation timeout now, defaulting to the non-scriptable timeout period.
  //  Then, once we know if the tab is scriptable, update the timeout period accordingly.
  //  We do this asyncronously because waiting for a tab to load can take a while.
  const dateTimeBeforeTabLoad = new Date().getTime();
  await startPrimaryTabActivationTimeout(windowId, tab.id, primaryTabActivationTimeoutPeriods.NON_SCRIPTABLE_TAB);
  Misc.callAsync(async () => {
    try {
      if (tab.status !== "unloaded") {
        const wasRemoved = await ChromeWindowHelper.waitForTabToLoad(tab);
        if (wasRemoved) {
          logger.warn(`startPrimaryTabActivation::callAsync::tabId ${tabId} was removed before it could load: ${wasRemoved}`);
          return;
        }
      }

      const latestActiveWindow = await get(windowId);
      if (!latestActiveWindow) {
        logger.warn(`startPrimaryTabActivation::callAsync::windowId ${windowId} no longer exists.`);
        return;
      }

      const { primaryTabActivationInfo } = latestActiveWindow;
      if (!primaryTabActivationInfo || primaryTabActivationInfo.tabId !== tabId) {
        logger.warn(`startPrimaryTabActivation::callAsync::tabId ${tabId} is no longer the primary tab.`);
        return;
      }

      const isTabScriptable = await ChromeWindowHelper.isTabScriptable(tab.id);

      const dateTimeAfterTabLoad = new Date().getTime();
      const deltaTime = dateTimeAfterTabLoad - dateTimeBeforeTabLoad;
      const timeoutPeriod =
        (isTabScriptable ? primaryTabActivationTimeoutPeriods.SCRIPTABLE_TAB : primaryTabActivationTimeoutPeriods.NON_SCRIPTABLE_TAB) - deltaTime;

      if (timeoutPeriod < 0) {
        logger.warn(`startPrimaryTabActivation::callAsync::tabId ${tabId} took longer to load than the timeout period.`);
        return;
      }

      logger.log(`startPrimaryTabActivation::callAsync::will restart primary tab activation timeout with timeoutPeriod: ${timeoutPeriod}`);
      await restartPrimaryTabActivationTimeout(windowId, timeoutPeriod);
    } catch (error) {
      // TODO: bubble error up to global level
      logger.error(`startPrimaryTabActivation::callAsync::${error}`);
    }
  });
}

export async function triggerPrimaryTabActivation(windowId: ChromeWindowId, tabId: ChromeTabId) {
  logger.log(`triggerPrimaryTabActivation::windowId: ${windowId}, tabId: ${tabId}`);
  const activeWindow = await getOrThrow(windowId);
  const { primaryTabActivationInfo } = activeWindow;
  if (primaryTabActivationInfo === null) {
    logger.warn(`triggerPrimaryTabActivation::windowId ${windowId} has no primaryTabActivationInfo`);
    return;
  }

  if (primaryTabActivationInfo.tabId !== tabId) {
    logger.warn(`triggerPrimaryTabActivation::tabId ${tabId} is not the primary tab`);
    return;
  }

  await clearPrimaryTabActivation(windowId);
  await setPrimaryTab(windowId, primaryTabActivationInfo.tabId);
}

export async function clearPrimaryTabActivation(windowId: ChromeWindowId) {
  logger.log(`clearPrimaryTabActivation::windowId: ${windowId}`);
  const activeWindow = await getOrThrow(windowId);
  const { primaryTabActivationInfo } = activeWindow;
  if (primaryTabActivationInfo === null) {
    logger.warn(`clearPrimaryTabActivation::windowId ${windowId} has no primaryTabActivationInfo`);
    return;
  }

  self.clearTimeout(primaryTabActivationInfo.timeoutId);
  await update(windowId, { primaryTabActivationInfo: null });
}

export async function restartPrimaryTabActivationTimeout(windowId: ChromeWindowId, timeoutPeriod?: number) {
  logger.log(`restartPrimaryTabActivationTimeout::windowId: ${windowId}`);
  const activeWindow = await getOrThrow(windowId);
  const { primaryTabActivationInfo } = activeWindow;
  if (primaryTabActivationInfo === null) {
    logger.warn(`restartPrimaryTabActivationTimeout::windowId ${windowId} has no primaryTabActivationInfo`);
    return;
  }

  self.clearTimeout(primaryTabActivationInfo.timeoutId);
  const newTimeoutPeriod = timeoutPeriod ?? primaryTabActivationInfo.timeoutPeriod;
  await startPrimaryTabActivationTimeout(windowId, primaryTabActivationInfo.tabId, newTimeoutPeriod);
}

async function startPrimaryTabActivationTimeout(windowId: ChromeWindowId, tabId: ChromeTabId, timeoutPeriod: number) {
  const primaryTabActivationTimeoutId = self.setTimeout(async () => {
    if (await ChromeWindowHelper.doesTabExist(tabId)) {
      const activeWindow = await get(windowId);
      if (!activeWindow) {
        logger.warn(`startPrimaryTabActivationTimeout::windowId ${windowId} no longer exists.`);
        return;
      }

      if (activeWindow.primaryTabActivationInfo?.tabId !== tabId) {
        logger.warn(
          `startPrimaryTabActivationTimeout::tabId ${tabId} is no longer the primary tab. The timeout should have been cancelled by the when the window was removed, but it was not.`
        );
        return;
      }

      await triggerPrimaryTabActivation(windowId, tabId);
    } else {
      logger.warn(
        `startPrimaryTabActivationTimeout::tabId ${tabId} no longer exists. The timeout should have been cancelled by the chrome.tabs.onRemoved listener the timeout owner, but it was not.`
      );
    }
  }, timeoutPeriod);

  try {
    await update(windowId, { primaryTabActivationInfo: { tabId: tabId, timeoutId: primaryTabActivationTimeoutId, timeoutPeriod } });
  } catch (error) {
    self.clearTimeout(primaryTabActivationTimeoutId);
    throw new Error(`startPrimaryTabActivationTimeout::${error}`);
  }
}

// just a helper used by certain tab/group related events like tabs.onActivated, tabs.onUpdated, tabs.onMoved and tabGroups.onUpdated
export async function clearOrRestartOrStartNewPrimaryTabActivationForTabEvent(
  activeWindowId: ChromeWindowId,
  tabId: ChromeTabId,
  tabIsActive: boolean,
  tabIsPinned: boolean,
  tabIsRemoved: boolean
) {
  const activeWindow = await get(activeWindowId);
  if (!activeWindow) {
    logger.warn(`clearOrRestartOrStartNewPrimaryTabActivationForTabEvent::active window not found:`, activeWindowId);
    return;
  }

  const { primaryTabActivationInfo } = activeWindow;
  const tabIsAwaitingPrimaryTabActivation = primaryTabActivationInfo?.tabId === tabId;

  logger.log(
    `clearOrRestartOrStartNewPrimaryTabActivationForTabEvent::tabId: ${tabId}, tabIsActive: ${tabIsActive}, tabIsPinned: ${tabIsPinned}, tabIsRemoved: ${tabIsRemoved}, primaryTabActivationInfo.tabId: ${primaryTabActivationInfo?.tabId}`
  );

  if (tabIsActive && tabIsPinned) {
    if (primaryTabActivationInfo !== null) {
      await clearPrimaryTabActivation(activeWindowId);
    }
    await setPrimaryTab(activeWindowId, tabId);
  } else if (tabIsActive && primaryTabActivationInfo !== null) {
    if (tabIsAwaitingPrimaryTabActivation) {
      await restartPrimaryTabActivationTimeout(activeWindowId);
    } else {
      await clearPrimaryTabActivation(activeWindowId);
      await startPrimaryTabActivation(activeWindowId, tabId);
    }
  } else if (tabIsActive) {
    await startPrimaryTabActivation(activeWindowId, tabId);
  } else if (primaryTabActivationInfo !== null) {
    if (tabIsRemoved) {
      await clearPrimaryTabActivation(activeWindowId);
    } else {
      await restartPrimaryTabActivationTimeout(activeWindowId);
    }
  }
}

export async function blurAllTabGroupsExcept(windowId: ChromeWindowId, tabGroupId: ChromeTabGroupId, tabGroups?: ChromeTabGroupWithId[]) {
  if (!tabGroups) {
    tabGroups = (await chrome.tabGroups.query({ windowId })) as ChromeTabGroupWithId[];
  }
  await Promise.all(
    tabGroups.map(async (tabGroup) => {
      if (tabGroup.id === tabGroupId) {
        return;
      }

      const updateProps: chrome.tabGroups.UpdateProperties = {};

      if (!tabGroup.collapsed) {
        updateProps.collapsed = true;
      }

      if (tabGroup.color !== "grey") {
        updateProps.color = "grey";
      }

      if (Object.keys(updateProps).length > 0) {
        await ChromeWindowHelper.updateTabGroupAndWait(tabGroup.id, updateProps);
      }
    })
  );
}

export async function expandAndHighlightTabGroup(tabGroupOrTabGroupId: ChromeTabGroupId | ChromeTabGroupWithId) {
  const tabGroupId = typeof tabGroupOrTabGroupId === "number" ? tabGroupOrTabGroupId : tabGroupOrTabGroupId.id;
  const tabGroup = typeof tabGroupOrTabGroupId === "number" ? await ChromeWindowHelper.getIfTabGroupExists(tabGroupId) : tabGroupOrTabGroupId;
  if (!tabGroup) {
    // FIXME: should this throw an error?
    logger.warn(`highlightTabGroup::tabGroupId ${tabGroupId} not found`);
    return;
  }

  const updateProps: chrome.tabGroups.UpdateProperties = {};

  if (tabGroup.collapsed) {
    updateProps.collapsed = false;
  }

  if (tabGroup.color !== "pink") {
    updateProps.color = "pink";
  }

  if (Object.keys(updateProps).length > 0) {
    await ChromeWindowHelper.updateTabGroupAndWait(tabGroup.id, updateProps);
  }
}
