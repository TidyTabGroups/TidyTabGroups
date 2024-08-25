import ActiveWindowManager from "../activeWindowManager";
import Database from "../database";
import Logger from "../logger";
import Misc from "../misc";
import Storage from "../storage";
import { LocalStorageShape } from "../types/types";

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

if (process.env.NODE_ENV === "development") {
  initializeFixedPages().catch((error) => {
    const myLogger = logger.createNestedLogger("initializeFixedPages");
    onError(myLogger.getPrefixedMessage(Misc.getErrorMessage(error)));
  });
}

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
    const defaultValues: LocalStorageShape = {
      userPreferences: {
        /* Functionality */
        repositionTabs: false,
        repositionTabGroups: false,
        alwaysGroupTabs: true,
        collapseUnfocusedTabGroups: true,
        activateTabInFocusedTabGroup: true,
        /* Other */
        reloadOnError: process.env.NODE_ENV === "production",
        createDummyFixedPageOnStartup: {
          enabled: true,
          type: "pinnedTab",
        },
        createOptionsFixedPageOnStartup: {
          enabled: true,
          type: "pinnedTab",
        },
      },
      lastSeenFocusModeColors: { focused: "cyan", nonFocused: "grey" },
      lastFocusedWindowHadFocusMode: false,
      lastError: null,
    };
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

async function initializeFixedPages() {
  Storage.addChangeListener(async (changes) => {
    if (changes.userPreferences?.newValue) {
      const newPreferences = changes.userPreferences.newValue;
      const oldPreferences = changes.userPreferences.oldValue;

      if (newPreferences.createDummyFixedPageOnStartup.enabled && !oldPreferences.createDummyFixedPageOnStartup.enabled) {
        await Misc.createDummyFixedPage(newPreferences.createDummyFixedPageOnStartup.type);
      }

      if (newPreferences.createOptionsFixedPageOnStartup.enabled && !oldPreferences.createOptionsFixedPageOnStartup.enabled) {
        await Misc.createOptionsFixedPage(newPreferences.createOptionsFixedPageOnStartup.type);
      }
    }
  });

  chrome.windows.onCreated.addListener(async (window) => {
    if (window.type === "normal") {
      const { createDummyFixedPageOnStartup, createOptionsFixedPageOnStartup } = (await Storage.getItems("userPreferences")).userPreferences;
      if (
        createDummyFixedPageOnStartup.enabled &&
        (createDummyFixedPageOnStartup.type === "pinnedTab" || createDummyFixedPageOnStartup.type === "tab")
      ) {
        await Misc.createDummyFixedPage(createDummyFixedPageOnStartup.type, window.id);
      }

      if (
        createOptionsFixedPageOnStartup.enabled &&
        (createOptionsFixedPageOnStartup.type === "pinnedTab" || createOptionsFixedPageOnStartup.type === "tab")
      ) {
        await Misc.createOptionsFixedPage(createOptionsFixedPageOnStartup.type, window.id);
      }
    }
  });

  chrome.runtime.onInstalled.addListener(async (installationDetails: chrome.runtime.InstalledDetails) => {
    const { userPreferences } = await Storage.getItems("userPreferences");
    if (userPreferences.createDummyFixedPageOnStartup.enabled) {
      await Misc.createDummyFixedPage(userPreferences.createDummyFixedPageOnStartup.type);
    }

    if (userPreferences.createOptionsFixedPageOnStartup.enabled) {
      await Misc.createOptionsFixedPage(userPreferences.createOptionsFixedPageOnStartup.type);
    }
  });
}
