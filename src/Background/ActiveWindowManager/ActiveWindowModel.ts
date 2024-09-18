import Types from "../../Shared/Types";
import { ChromeWindowId, ChromeTabGroupId } from "../../Shared/Types/Types";
import Misc from "../../Shared/Misc";
import Logger from "../../Shared/Logger";
import * as ActiveWindowDatabase from "./ActiveWindowDatabase";

const logger = Logger.createLogger("ActiveWindow", { color: "#b603fc" });

let activeWindows: Types.ActiveWindow[] = [];

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

function clearInternal() {
  throwIfNotSynced("clearInternal");
  activeWindows = [];
  ActiveWindowDatabase.clear().catch((error) => {
    // TODO: bubble error up to global level
    logger.error(`reactivateAllWindows::failed to clear database: ${error}`);
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

export async function clear() {
  await waitForSync();
  return clearInternal();
}

export function chromeTabGroupToActiveWindowTabGroup(
  tabGroup: chrome.tabGroups.TabGroup,
  otherProperties?: { useTabTitle: Types.ActiveWindowTabGroup["useTabTitle"]; lastActiveTabId: Types.ActiveWindowTabGroup["lastActiveTabId"] }
) {
  const activeWindowTabGroup = {
    id: tabGroup.id,
    windowId: tabGroup.windowId,
    color: tabGroup.color,
    collapsed: tabGroup.collapsed,
    useTabTitle: false,
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
export async function getAllActiveWindowTabGroups() {
  return (await getAll()).flatMap((activeWindow) => activeWindow.tabGroups);
}

// TODO: Use updateActiveWindowTabGroups with a single tabGroup for this implementation
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
  await update(windowId, {
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

  return updatedTabGroup;
}

type TabGroupUpdatePropertiesWithId = { id: chrome.tabGroups.TabGroup["id"] } & Partial<chrome.tabGroups.UpdateProperties>;
export async function updateActiveWindowTabGroups(windowId: ChromeWindowId, tabGroups: TabGroupUpdatePropertiesWithId[]) {
  const activeWindow = await getOrThrow(windowId);

  const tabGroupsById: { [tabGroupId: ChromeTabGroupId]: TabGroupUpdatePropertiesWithId } = tabGroups.reduce(
    (acc, tabGroup) => ({ ...acc, [tabGroup.id]: tabGroup }),
    {}
  );

  const newActiveWindowTabGroups = activeWindow.tabGroups.map((activeWindowTabGroup) => {
    if (tabGroupsById[activeWindowTabGroup.id]) {
      return {
        ...activeWindowTabGroup,
        ...tabGroupsById[activeWindowTabGroup.id],
      } as Types.ActiveWindowTabGroup;
    }
    return activeWindowTabGroup;
  });
  return await update(activeWindow.windowId, { tabGroups: newActiveWindowTabGroups });
}
