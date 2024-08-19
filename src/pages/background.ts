import ActiveWindowManager from "../activeWindowEventManager";
import Database from "../database";
import Logger from "../logger";
import Misc from "../misc";
import { ActiveWindow } from "../model";
import * as Storage from "../storage";
import { LocalStorageShape, ChromeWindowWithId } from "../types/types";

const logger = Logger.createLogger("Background", { color: "pink" });

Database.initializeDatabaseConnection("model").catch((error) => {
  const myLogger = logger.createNestedLogger("Database.initializeDatabaseConnection");
  onError(myLogger.getPrefixedMessage(Misc.getErrorMessage(error)));
});

ActiveWindowManager.initialize((error) => {
  const myLogger = logger.createNestedLogger("ActiveWindowManager.initialize");
  onError(myLogger.getPrefixedMessage(Misc.getErrorMessage(error)));
});

initializeStorage().catch((error) => {
  const myLogger = logger.createNestedLogger("initializeStorage");
  onError(myLogger.getPrefixedMessage(Misc.getErrorMessage(error)));
});

chrome.action.onClicked.addListener(function (tab) {
  chrome.runtime.openOptionsPage();
});

async function onError(message: string) {
  const myLogger = logger.createNestedLogger("onError");
  myLogger.error(message);

  if (process.env.NODE_ENV === "development") {
    chrome.action.setBadgeText({ text: "🚨" });
    chrome.action.setBadgeBackgroundColor({ color: "red" });
    chrome.action.setBadgeTextColor({ color: "white" });
    chrome.action.setPopup({ popup: "/error_popup.html" });
    Storage.setItems({ lastError: message }).then(() => {
      chrome.action.openPopup();
    });
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
        alwaysGroupTabs: true,
        collapseUnfocusedTabGroups: true,
        activateTabInFocusedTabGroup: true,
      },
      lastSeenFocusModeColors: activeWindow?.focusMode?.colors || { focused: "pink", nonFocused: "purple" },
      lastFocusedWindowHadFocusMode: activeWindow?.focusMode ? true : false,
      lastError: null,
    };
  } catch (error) {
    throw new Error(`getLocalStorageDefaultValues::An error occurred while getting the default values: ${error}`);
  }
}
