import ActiveWindowManager from "../activeWindowManager";
import Database from "../database";
import Logger from "../logger";
import { ActiveWindow } from "../model";
import * as Storage from "../storage";
import { LocalStorageShape, ChromeWindowWithId } from "../types/types";

const logger = Logger.getLogger("Background", { color: "pink" });

Database.initializeDatabaseConnection("model").catch(onError);
ActiveWindowManager.initialize(onError);
initializeStorage().catch(onError);

chrome.action.onClicked.addListener(function (tab) {
  chrome.runtime.openOptionsPage();
});

async function onError(error: any) {
  logger.error("onError::An error occurred in the background page. Will try to recover...", error);
  chrome.runtime.reload();
}

async function initializeStorage() {
  try {
    const defaultValues = await getLocalStorageDefaultValues();
    const keys = Object.keys(defaultValues) as (keyof LocalStorageShape)[];
    const items = await chrome.storage.local.get(keys);
    const missingItems = keys.filter((key) => !items.hasOwnProperty(key));
    const newItems = missingItems.reduce((acc, key) => ({ ...acc, [key]: defaultValues[key] }), {});
    await chrome.storage.local.set(newItems);
    Storage.start();
  } catch (error) {
    throw new Error(`initializeStorage::An error occurred while initializing the storage: ${error}`);
  }
}

async function getLocalStorageDefaultValues() {
  return {
    userPreferences: {
      repositionTabs: false,
      repositionTabGroups: false,
      addNewTabToFocusedTabGroup: true,
      collapseUnfocusedTabGroups: true,
      activateTabInFocusedTabGroup: true,
    },
  };
}
