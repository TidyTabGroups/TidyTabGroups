import ActiveWindowManager from "../activeWindowEventManager";
import Database from "../database";
import Logger from "../logger";
import { ActiveWindow } from "../model";
import * as Storage from "../storage";
import { LocalStorageShape, ChromeWindowWithId } from "../types/types";

const logger = Logger.createLogger("Background", { color: "pink" });

Database.initializeDatabaseConnection("model").catch(onError);
ActiveWindowManager.initialize(onError);
initializeStorage().catch(onError);

chrome.action.onClicked.addListener(function (tab) {
  chrome.runtime.openOptionsPage();
});

async function onError() {
  logger.error("onError::An error occurred in the background page. Will try to recover...");

  if (process.env.NODE_ENV === "development") {
    chrome.action.setBadgeText({ text: "🚨" });
    chrome.action.setBadgeBackgroundColor({ color: "red" });
    chrome.action.setBadgeTextColor({ color: "white" });
    chrome.action.setPopup({ popup: "/error_popup.html" });
    chrome.action.openPopup();
  } else {
    chrome.runtime.reload();
  }
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
    // TODO: log the error
    throw new Error(`initializeStorage::An error occurred while initializing the storage: ${error}`);
  }
}

async function getLocalStorageDefaultValues(): Promise<LocalStorageShape> {
  try {
    const currentWindow = (await chrome.windows.getCurrent()) as ChromeWindowWithId;
    const activeWindow = await ActiveWindow.get(currentWindow.id);

    return {
      userPreferences: {
        repositionTabs: false,
        repositionTabGroups: false,
        addNewTabToFocusedTabGroup: true,
        collapseUnfocusedTabGroups: true,
        activateTabInFocusedTabGroup: true,
      },
      lastSeenFocusModeColors: activeWindow?.focusMode?.colors || { focused: "pink", nonFocused: "purple" },
      lastFocusedWindowHadFocusMode: activeWindow?.focusMode ? true : false,
    };
  } catch (error) {
    throw new Error(`getLocalStorageDefaultValues::An error occurred while getting the default values: ${error}`);
  }
}
