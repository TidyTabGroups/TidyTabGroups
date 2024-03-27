import { IDBPTransaction, IndexKey, IndexNames, StoreNames } from "idb";
import Database from "../database";
import Types from "../types";
import {
  ChromeWindowWithId,
  ChromeWindowId,
  ChromeTabWithId,
  ChromeTabGroupWithId,
  ChromeTabGroupId,
  ChromeTabId,
  YesOrNoOrNA,
} from "../types/types";
import * as ActiveTabGroup from "./ActiveTabGroup";
import Misc from "../misc";
import ChromeWindowHelper from "../chromeWindowHelper";
import Logger from "../logger";
import { ActiveWindow } from ".";

const logger = Logger.getLogger("ActiveWindow", { color: "#b603fc" });

let windowsBeingActivated: ChromeWindowId[] = [];
let activatingAllWindows = false;
let reactivatingAllWindows = false;

export async function getOrThrow(
  id: Types.ActiveWindow["windowId"],
  _transaction?: IDBPTransaction<Types.ModelDataBase, ["activeWindows", ...StoreNames<Types.ModelDataBase>[]], "readonly" | "readwrite">
) {
  const [transaction] = await Database.useOrCreateTransaction("model", _transaction, ["activeWindows"], "readonly");
  const activeWindow = await transaction.objectStore("activeWindows").get(id);
  if (!activeWindow) {
    throw new Error(`ActiveWindow::getOrThrow with id ${id} not found`);
  }

  return activeWindow;
}

export async function get(
  id: Types.ActiveWindow["windowId"],
  _transaction?: IDBPTransaction<Types.ModelDataBase, ["activeWindows", ...StoreNames<Types.ModelDataBase>[]], "readonly">
) {
  const [transaction] = await Database.useOrCreateTransaction("model", _transaction, ["activeWindows"], "readonly");
  return await transaction.objectStore("activeWindows").get(id);
}

export async function getKey(
  id: Types.ActiveWindow["windowId"],
  _transaction?: IDBPTransaction<Types.ModelDataBase, ["activeWindows", ...StoreNames<Types.ModelDataBase>[]], "readonly">
) {
  const [transaction] = await Database.useOrCreateTransaction("model", _transaction, ["activeWindows"], "readonly");
  return await transaction.objectStore("activeWindows").getKey(id);
}

export async function getKeyByIndex<ActiveWindowIndexName extends IndexNames<Types.ModelDataBase, "activeWindows">>(
  indexName: ActiveWindowIndexName,
  indexValue: IndexKey<Types.ModelDataBase, "activeWindows", ActiveWindowIndexName>,
  _transaction?: IDBPTransaction<Types.ModelDataBase, ["activeWindows", ...StoreNames<Types.ModelDataBase>[]], "readonly">
) {
  const [transaction] = await Database.useOrCreateTransaction("model", _transaction, ["activeWindows"], "readonly");
  return await transaction.objectStore("activeWindows").index(indexName).getKey(indexValue);
}

export async function getByIndex<ActiveWindowIndexName extends IndexNames<Types.ModelDataBase, "activeWindows">>(
  indexName: ActiveWindowIndexName,
  indexValue: IndexKey<Types.ModelDataBase, "activeWindows", ActiveWindowIndexName>,
  _transaction?: IDBPTransaction<Types.ModelDataBase, ["activeWindows", ...StoreNames<Types.ModelDataBase>[]], "readonly">
) {
  const [transaction] = await Database.useOrCreateTransaction("model", _transaction, ["activeWindows"], "readonly");
  return await transaction.objectStore("activeWindows").index(indexName).get(indexValue);
}

export async function add(
  activeWindow: Types.ActiveWindow,
  _transaction?: IDBPTransaction<Types.ModelDataBase, ["activeWindows", ...StoreNames<Types.ModelDataBase>[]], "readwrite">
) {
  const [transaction, didProvideTransaction] = await Database.useOrCreateTransaction("model", _transaction, ["activeWindows"], "readwrite");
  await transaction.objectStore("activeWindows").add(activeWindow);

  if (!didProvideTransaction) {
    await transaction.done;
  }

  return activeWindow;
}

export async function remove(
  id: Types.ActiveWindow["windowId"],
  _transaction?: IDBPTransaction<Types.ModelDataBase, ["activeWindows", ...StoreNames<Types.ModelDataBase>[]], "readwrite">
) {
  const [transaction, didProvideTransaction] = await Database.useOrCreateTransaction("model", _transaction, ["activeWindows"], "readwrite");

  const key = await transaction.objectStore("activeWindows").getKey(id);
  if (!key) {
    throw new Error(`ActiveWindow::remove with id ${id} not found`);
  }

  await transaction.objectStore("activeWindows").delete(id);

  if (!didProvideTransaction) {
    await transaction.done;
  }
}

export async function update(
  id: Types.ActiveWindow["windowId"],
  updatedProperties: Partial<Types.ActiveWindow>,
  _transaction?: IDBPTransaction<Types.ModelDataBase, ["activeWindows", ...StoreNames<Types.ModelDataBase>[]], "readwrite">
) {
  const [transaction, didProvideTransaction] = await Database.useOrCreateTransaction("model", _transaction, ["activeWindows"], "readwrite");

  const activeWindow = await getOrThrow(id, transaction);

  await transaction.objectStore("activeWindows").put({ ...activeWindow, ...updatedProperties });

  if (!didProvideTransaction) {
    await transaction.done;
  }
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

  try {
    const allObjectStores: Array<"activeWindows" | "activeTabGroups"> = ["activeWindows", "activeTabGroups"];
    const transaction = await Database.createTransaction<Types.ModelDataBase, typeof allObjectStores, "readwrite">(
      "model",
      allObjectStores,
      "readwrite"
    );
    await Promise.all(allObjectStores.map((store) => transaction.objectStore(store).clear()));
    await transaction.done;

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

  // 1
  const remaingTabGroupsToCollapse = tabGroups.filter((tabGroup) => tabGroup.id !== selectedTab.groupId);
  const collapseNextTabGroup = async () => {
    const tabGroup = remaingTabGroupsToCollapse.pop();
    if (!tabGroup) {
      return;
    }

    if (!tabGroup.collapsed) {
      await ChromeWindowHelper.updateTabGroupAndWait(tabGroup.id, { collapsed: true });
    }
    await collapseNextTabGroup();
  };

  await collapseNextTabGroup();

  // 2
  const selectedTabGroup = tabGroups.find((tabGroup) => tabGroup.id === selectedTab.groupId);
  if (selectedTabGroup && selectedTabGroup.collapsed) {
    await ChromeWindowHelper.updateTabGroupAndWait(selectedTabGroup.id, { collapsed: false });
  }

  const transaction = await Database.createTransaction<Types.ModelDataBase, ["activeWindows", "activeTabGroups"], "readwrite">(
    "model",
    ["activeWindows", "activeTabGroups"],
    "readwrite"
  );
  await add(
    {
      windowId,
      lastActiveTabInfo: { tabId: selectedTab.id, tabGroupId: selectedTab.groupId, title: selectedTab.title },
      primaryTabActivationInfo: null,
    },
    transaction
  );
  await Promise.all(
    tabGroups.map((tabGroup) => {
      ActiveTabGroup.add(tabGroup, transaction);
    })
  );

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

  const uncollapsedTabGroups = (await chrome.tabGroups.query({ windowId, collapsed: false })) as ChromeTabGroupWithId[];
  uncollapsedTabGroups.forEach(async (tabGroup) => {
    if (tabGroup.id !== tab.groupId) {
      await ChromeWindowHelper.updateTabGroupAndWait(tabGroup.id, { collapsed: true });
    }
  });
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

  if (tab.status !== "unloaded") {
    const wasRemoved = await ChromeWindowHelper.waitForTabToLoad(tab);
    if (wasRemoved) {
      logger.warn(`startPrimaryTabActivation::tabId ${tabId} was removed before it could load: ${wasRemoved}`);
      return;
    }
  }

  const isTabScriptable = await ChromeWindowHelper.isTabScriptable(tab.id);
  const timeoutPeriod = isTabScriptable ? 15000 : 6500;
  await startPrimaryTabActivationTimeout(windowId, tab.id, timeoutPeriod);
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
  await ActiveWindow.update(windowId, { primaryTabActivationInfo: null });
}

export async function restartPrimaryTabActivationTimeout(windowId: ChromeWindowId) {
  logger.log(`restartPrimaryTabActivationTimeout::windowId: ${windowId}`);
  const activeWindow = await getOrThrow(windowId);
  const { primaryTabActivationInfo } = activeWindow;
  if (primaryTabActivationInfo === null) {
    logger.warn(`restartPrimaryTabActivationTimeout::windowId ${windowId} has no primaryTabActivationInfo`);
    return;
  }

  self.clearTimeout(primaryTabActivationInfo.timeoutId);
  await startPrimaryTabActivationTimeout(windowId, primaryTabActivationInfo.tabId, primaryTabActivationInfo.timeoutPeriod);
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
    await ActiveWindow.update(windowId, { primaryTabActivationInfo: { tabId: tabId, timeoutId: primaryTabActivationTimeoutId, timeoutPeriod } });
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
      await ActiveWindow.clearPrimaryTabActivation(activeWindowId);
    } else {
      await restartPrimaryTabActivationTimeout(activeWindowId);
    }
  }
}
