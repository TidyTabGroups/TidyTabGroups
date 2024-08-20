import ActiveWindowManager from "../activeWindowEventManager";
import ChromeWindowHelper from "../chromeWindowHelper";
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

Storage.addChangeListener(async (changes) => {
  if (changes.userPreferences?.newValue) {
    const newPreferences = changes.userPreferences.newValue;
    const oldPreferences = changes.userPreferences.oldValue;

    if (newPreferences.createDummyTabOnStartup && !oldPreferences.createDummyTabOnStartup) {
      Misc.createDummyPageWindow();
    }

    if (newPreferences.createOptionsPageTabOnStartup && !oldPreferences.createOptionsPageTabOnStartup) {
      Misc.createOptionsPageWindow();
    }
  }
});

Storage.getItems("userPreferences").then(async ({ userPreferences }) => {
  const myLogger = logger.createNestedLogger("Storage.getItems('userPreferences')");
  try {
    if (userPreferences.createDummyTabOnStartup) {
      await Misc.createDummyPageWindow();
    }

    if (userPreferences.createOptionsPageTabOnStartup) {
      await Misc.createOptionsPageWindow();
    }
  } catch (error) {
    onError(myLogger.getPrefixedMessage(Misc.getErrorMessage(error)));
  }
});

async function onError(message: string) {
  const myLogger = logger.createNestedLogger("onError");
  myLogger.error(message);

  let reload = false;
  try {
    const { userPreferences } = await Storage.getItems("userPreferences");
    reload = userPreferences.reloadOnError;
  } catch (error) {
    myLogger.warn(`An error occurred while getting the user preferences: ${error}`);
  }

  if (reload) {
    chrome.runtime.reload();
  } else {
    chrome.action.setBadgeText({ text: "🚨" });
    chrome.action.setBadgeBackgroundColor({ color: "red" });
    chrome.action.setBadgeTextColor({ color: "white" });
    chrome.action.setPopup({ popup: "/error_popup.html" });

    try {
      await Storage.setItems({ lastError: message });
    } catch (error) {
      myLogger.warn(`An error occurred while setting the last error: ${error}`);
    }

    chrome.action.openPopup();
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
    const currentWindow = await ChromeWindowHelper.getIfCurrentWindowExists();
    const activeWindow = currentWindow ? await ActiveWindow.get(currentWindow.id) : null;

    return {
      userPreferences: {
        /* Functionality */
        repositionTabs: false,
        repositionTabGroups: false,
        alwaysGroupTabs: true,
        collapseUnfocusedTabGroups: true,
        activateTabInFocusedTabGroup: true,
        /* Other */
        reloadOnError: process.env.NODE_ENV === "production",
        createDummyTabOnStartup: process.env.NODE_ENV === "development",
        createOptionsPageTabOnStartup: process.env.NODE_ENV === "development",
      },
      lastSeenFocusModeColors: activeWindow?.focusMode?.colors || { focused: "pink", nonFocused: "purple" },
      lastFocusedWindowHadFocusMode: activeWindow?.focusMode ? true : false,
      lastError: null,
    };
  } catch (error) {
    throw new Error(`getLocalStorageDefaultValues::An error occurred while getting the default values: ${error}`);
  }
}
