import { ActiveWindow } from "../model";
import { ChromeTabId, ChromeTabWithId, ChromeWindowId, ChromeWindowWithId } from "../types/types";
import ChromeWindowHelper from "../chromeWindowHelper";
import Logger from "../logger";
import Types from "../types";
import * as Storage from "../storage";
import * as ActiveWindowEvents from "./ActiveWindowEvents";
import * as MouseInPageTracker from "./MouseInPageTracker";

const logger = Logger.getLogger("activeWindowManager", { color: "#fcba03" });

const TAB_NOT_UP_TO_DATE_MESSAGE = (tabOrTabId: ChromeTabId | chrome.tabs.Tab) => {
  if (typeof tabOrTabId === "number") {
    return `tab is not up to date, tabId: ${tabOrTabId}`;
  } else {
    return `tabUpToDate not found - tabId: ${tabOrTabId.id}, tab.title: ${tabOrTabId.title}`;
  }
};

export async function initialize(onError: () => void) {
  let asyncInitializationSteps = new Promise<void>(async (resolve, reject) => {
    const myLogger = logger.getNestedLogger("initialize::asyncInitializationSteps");
    try {
      await MouseInPageTracker.initialize();
      MouseInPageTracker.addOnChangeListener((status, tab: ChromeTabWithId) => {
        queueOperationIfWindowIsActive(
          async (activeWindow) => {
            const tabUpToDate = await ChromeWindowHelper.getIfTabExists(tab.id);
            if (!tabUpToDate) {
              logger.warn(TAB_NOT_UP_TO_DATE_MESSAGE(tab));
              return;
            }

            await ActiveWindowEvents.onMouseInPageStatusChanged(activeWindow, tabUpToDate, status);
          },
          tab.windowId,
          false,
          "onMouseEnterPage"
        );
      });
      resolve();
    } catch (error) {
      reject(myLogger.getPrefixedMessage(`error initializing: ${error}`));
    }
  });

  Storage.addChangeListener(async (changes) => {
    const { userPreferences } = changes;
    if (userPreferences && !userPreferences.oldValue?.collapseUnfocusedTabGroups && userPreferences.newValue?.collapseUnfocusedTabGroups) {
      const activeTabs = await chrome.tabs.query({ active: true });
      await Promise.all(activeTabs.map((tab) => ActiveWindow.collapseUnFocusedTabGroups(tab.windowId, tab.groupId)));
    }
  });

  chrome.runtime.onInstalled.addListener((details: chrome.runtime.InstalledDetails) => {
    queueOperation(() => onInstalled(details), true);
  });

  chrome.windows.onCreated.addListener((window: chrome.windows.Window) => {
    if (!window.id || window.type !== "normal") {
      logger.warn("onWindowCreated::window is not valid:", window);
      return;
    }

    queueOperation(() => ActiveWindowEvents.onWindowCreated(window as ChromeWindowWithId), true);
  });

  chrome.windows.onRemoved.addListener((windowId: ChromeWindowId) => {
    queueOperationIfWindowIsActive(ActiveWindowEvents.onWindowRemoved, windowId, true, "onWindowRemoved");
  });

  chrome.windows.onFocusChanged.addListener((windowId: ChromeWindowId) => {
    queueOperation(async () => {
      // check the up-to-date focused window because it could have changed
      const lastFocusedWindow = (await chrome.windows.getLastFocused()) as ChromeWindowWithId;
      if (windowId === chrome.windows.WINDOW_ID_NONE ? lastFocusedWindow.focused : lastFocusedWindow.id !== windowId) {
        logger.warn(
          `onFocusChanged::focused window not up to date - windowId: ${windowId}, lastFocusedWindow: ${lastFocusedWindow.id}, lastFocusedWindow.focused: ${lastFocusedWindow.focused}`
        );
        return;
      }
      await ActiveWindowEvents.onWindowFocusChanged(windowId);
    }, false);
  });

  chrome.tabGroups.onCreated.addListener((tabGroup: chrome.tabGroups.TabGroup) => {
    queueOperationIfWindowIsActive(
      (activeWindow) => ActiveWindowEvents.onTabGroupCreated(activeWindow, tabGroup),
      tabGroup.windowId,
      false,
      "onTabGroupCreated"
    );
  });

  chrome.tabGroups.onRemoved.addListener((tabGroup: chrome.tabGroups.TabGroup) => {
    queueOperationIfWindowIsActive(
      (activeWindow) => ActiveWindowEvents.onTabGroupRemoved(activeWindow, tabGroup),
      tabGroup.windowId,
      false,
      "onTabGroupRemoved"
    );
  });

  chrome.tabGroups.onUpdated.addListener((tabGroup: chrome.tabGroups.TabGroup) => {
    queueOperationIfWindowIsActive(
      (activeWindow) => ActiveWindowEvents.onTabGroupUpdated(activeWindow, tabGroup),
      tabGroup.windowId,
      false,
      "onTabGroupUpdated"
    );
  });

  chrome.tabs.onCreated.addListener((tab: chrome.tabs.Tab) => {
    queueOperationIfWindowIsActive((activeWindow) => ActiveWindowEvents.onTabCreated(activeWindow, tab), tab.windowId, false, "onTabCreated");
  });

  chrome.tabs.onActivated.addListener((activeInfo: chrome.tabs.TabActiveInfo) => {
    queueOperationIfWindowIsActive(
      (activeWindow) => ActiveWindowEvents.onTabActivated(activeWindow, activeInfo),
      activeInfo.windowId,
      false,
      "onTabActivated"
    );
  });

  chrome.tabs.onUpdated.addListener((tabId: ChromeTabId, changeInfo: chrome.tabs.TabChangeInfo, tab: chrome.tabs.Tab) => {
    const myLogger = logger.getNestedLogger("tabs.onUpdated");
    // only handle these changeInfo properties
    const validChangeInfo: Array<keyof chrome.tabs.TabChangeInfo> = ["groupId", "title", "pinned"];
    if (!validChangeInfo.find((key) => changeInfo[key] !== undefined)) {
      return;
    }

    queueOperationIfWindowIsActive(
      async (activeWindow) => {
        const tabUpToDate = await ChromeWindowHelper.getIfTabExists(tabId);
        if (!tabUpToDate) {
          myLogger.warn(TAB_NOT_UP_TO_DATE_MESSAGE(tab));
          return;
        }

        (Object.keys(changeInfo) as (keyof chrome.tabs.TabChangeInfo)[]).forEach((key) => {
          if (tabUpToDate[key] !== changeInfo[key]) {
            myLogger.warn(`tab is not up to date for changeInfo.key:${key}, tabId: ${tabId}, tab title: ${tab.title}`);
            delete changeInfo[key];
          }
        });
        await ActiveWindowEvents.onTabUpdated(activeWindow, tabUpToDate, changeInfo);
      },
      tab.windowId,
      false,
      "onTabUpdated"
    );
  });

  chrome.tabs.onRemoved.addListener((tabId: ChromeTabId, removeInfo: chrome.tabs.TabRemoveInfo) => {
    queueOperationIfWindowIsActive(
      (activeWindow) => ActiveWindowEvents.onTabRemoved(activeWindow, tabId, removeInfo),
      removeInfo.windowId,
      false,
      "onTabRemoved"
    );
  });

  chrome.tabs.onMoved.addListener((tabId: ChromeTabId, moveInfo: chrome.tabs.TabMoveInfo) => {
    queueOperationIfWindowIsActive(
      (activeWindow) => ActiveWindowEvents.onTabMoved(activeWindow, tabId, moveInfo),
      moveInfo.windowId,
      false,
      "onTabMoved"
    );
  });

  chrome.tabs.onAttached.addListener((tabId: ChromeTabId, attachInfo: chrome.tabs.TabAttachInfo) => {
    const myLogger = logger.getNestedLogger("tabs.onAttached");
    queueOperationIfWindowIsActive(
      async (activeWindow) => {
        const tabUpToDate = await ChromeWindowHelper.getIfTabExists(tabId);
        if (!tabUpToDate) {
          myLogger.warn(TAB_NOT_UP_TO_DATE_MESSAGE(tabId));
          return;
        }

        if (tabUpToDate.windowId !== attachInfo.newWindowId) {
          myLogger.warn(`tabUpToDate is no longer attached to this window - windowId: ${activeWindow.windowId}, tabId`, {
            activeWindowWindowId: activeWindow.windowId,
            tabId,
            tabUpToDateTitle: tabUpToDate.title,
            tabUpToDateWindowId: tabUpToDate.windowId,
          });
          return;
        }

        await ActiveWindowEvents.onTabAttached(activeWindow, tabUpToDate);
      },
      attachInfo.newWindowId,
      false,
      "onTabAttached"
    );
  });

  chrome.tabs.onReplaced.addListener((addedTabId: ChromeTabId, removedTabId: ChromeTabId) => {
    queueOperationIfWindowIsActive(
      (activeWindow) => ActiveWindowEvents.onTabReplaced(activeWindow, addedTabId, removedTabId),
      new Promise(async (resolve, reject) => {
        const addedTab = await ChromeWindowHelper.getIfTabExists(addedTabId);
        if (addedTab?.id !== undefined) {
          resolve(addedTab.windowId);
        } else {
          reject(`onTabReplaced::addedTab not found for addedTabId: ${addedTabId}`);
        }
      }),
      false,
      "onTabReplaced"
    );
  });

  chrome.runtime.onMessage.addListener((message: any, sender: chrome.runtime.MessageSender, sendResponse: (response?: any) => void) => {
    const myLogger = logger.getNestedLogger("onMessage");
    if (!message || !message.type) {
      myLogger.warn(`message is not valid - message: ${message}, sender: ${sender}`);
      return;
    }

    myLogger.log(`message:`, message);

    const messageTypes = ["getActiveWindow", "updateActiveWindow"];
    if (!messageTypes.includes(message.type)) {
      return;
    }

    queueOperation(async () => {
      try {
        if (message.type === messageTypes[0]) {
          const { windowId } = message.data as { windowId: ChromeWindowId };
          const activeWindow = await ActiveWindow.get(windowId);
          sendResponse({ activeWindow });
        } else if (message.type === messageTypes[1]) {
          const { windowId, updateProps } = message.data as { windowId: Types.ActiveWindow["windowId"]; updateProps: Partial<Types.ActiveWindow> };
          const updatedActiveWindow = await ActiveWindow.update(windowId, updateProps);
          sendResponse({ activeWindow: updatedActiveWindow });
        } else {
          throw new Error("message type is invalid");
        }
      } catch (error) {
        const errorMessage = myLogger.getPrefixedMessage(`error processing message:${error}`);
        sendResponse({ error: errorMessage });
        throw new Error(errorMessage);
      }
    }, true);

    // return true for the asynchronous response
    return true;
  });

  type ActiveWindowQueuedEventOperation = (activeWindow: Types.ActiveWindow) => Promise<void>;
  type QueuedEventOperation = () => Promise<void>;
  let operationQueue: QueuedEventOperation[] = [];
  let isProcessingQueue = false;
  let isQueueSuspended = false;

  function queueOperationIfWindowIsActive(
    operation: ActiveWindowQueuedEventOperation,
    windowIdOrPromisedWindowId: ChromeWindowId | Promise<ChromeWindowId>,
    next: boolean,
    name: string
  ) {
    const myLogger = logger.getNestedLogger("queueOperationIfWindowIsActive");
    queueOperation(async () => {
      let activeWindow: Types.ActiveWindow;
      try {
        const windowId = await windowIdOrPromisedWindowId;
        const myActiveWindow = await ActiveWindow.get(windowId);
        if (!myActiveWindow) {
          myLogger.warn("activeWindow not found, ignoring operation: ", name);
          return;
        }
        activeWindow = myActiveWindow;
      } catch (error) {
        throw new Error(myLogger.getPrefixedMessage(`error trying to get active window for operation: ${name}: ${error}`));
      }
      await operation(activeWindow);
    }, next);
  }

  function queueOperation(operation: QueuedEventOperation, next: boolean) {
    if (next) {
      queueNext(operation);
    } else {
      queueEnd(operation);
    }

    if (!isProcessingQueue) {
      processQueue();
    }
  }

  function queueNext(operation: QueuedEventOperation) {
    operationQueue.unshift(operation);
  }

  function queueEnd(operation: QueuedEventOperation) {
    operationQueue.push(operation);
  }

  async function processQueue(): Promise<void> {
    if (isProcessingQueue) {
      throw new Error("processQueue::Queue is already being processed");
    }

    try {
      await asyncInitializationSteps;
    } catch (error) {
      logger.error("processQueue::Error during asyncInitializationSteps:", error);
      onBackgroundEventError();
      return;
    }

    isProcessingQueue = true;
    while (operationQueue.length > 0 && !isQueueSuspended) {
      const currentOperation = operationQueue.shift();
      if (currentOperation) {
        const operationTimeoutId = setTimeout(() => {
          logger.error("processQueue::Operation timed out:", currentOperation);
          onBackgroundEventError();
        }, 7500);
        try {
          await currentOperation();
        } catch (error) {
          logger.error("processQueue::Error processing operation:", error);
          onBackgroundEventError();
        } finally {
          clearTimeout(operationTimeoutId);
        }
      }
    }
    isProcessingQueue = false;
  }

  function onBackgroundEventError() {
    isQueueSuspended = true;
    onError();
  }
}

export async function onInstalled(details: chrome.runtime.InstalledDetails) {
  logger.log(`onInstalled::Extension was installed because of: ${details.reason}`);
  if (details.reason === "install") {
    // TODO: open the onboarding page
  }

  const newActiveWindows = await ActiveWindow.reactivateAllWindows();
  logger.log(`onInstalled::reactivated all windows:`, newActiveWindows);

  // inject the content script into all tabs
  const tabs = (await chrome.tabs.query({})) as ChromeTabWithId[];
  for (const tab of tabs) {
    chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, files: ["js/vendor.js", "js/content_script.js"] });
  }

  // Misc.openDummyTab();
}
