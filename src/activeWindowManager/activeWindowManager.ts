import { ActiveWindow } from "../model";
import { ChromeTabId, ChromeTabWithId, ChromeWindowId, ChromeWindowWithId } from "../types/types";
import ChromeWindowHelper from "../chromeWindowHelper";
import Logger from "../logger";
import Types from "../types";
import * as Storage from "../storage";
import * as ActiveWindowEvents from "./ActiveWindowEvents";

const logger = Logger.getLogger("activeWindowManager", { color: "#fcba03" });

export async function initialize(onError: () => void) {
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
    queueOperationIfWindowIsActive(ActiveWindowEvents.onWindowFocusChanged, windowId, false, "onWindowFocusChanged");
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
    // only handle these changeInfo properties
    const validChangeInfo: Array<keyof chrome.tabs.TabChangeInfo> = ["groupId", "title"];
    if (!validChangeInfo.find((key) => changeInfo[key] !== undefined)) {
      return;
    }

    // get the highlighted tabs right now because the highlighted tabs could change by the time the operation is executed
    const getHighlightedTabsPromise =
      changeInfo.groupId === chrome.tabGroups.TAB_GROUP_ID_NONE
        ? (chrome.tabs.query({ highlighted: true }) as Promise<ChromeTabWithId[]>)
        : undefined;
    queueOperationIfWindowIsActive(
      (activeWindow) => ActiveWindowEvents.onTabUpdated(activeWindow, tabId, changeInfo, tab, getHighlightedTabsPromise),
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
    let windowId: ChromeWindowId;
    if (sender.tab) {
      windowId = sender.tab.windowId;
    } else if (message.data?.windowId) {
      windowId = message.data.windowId;
    } else {
      logger.warn("onMessage::sender windowId is not valid:", sender);
      return;
    }
    queueOperationIfWindowIsActive((activeWindow) => onMessage(activeWindow, message, sender, sendResponse), windowId, false, "onMessage");
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
  // TODO: only do this if the user has the repositionTabs or repositionTabGroups preferences enabled
  const tabs = (await chrome.tabs.query({})) as ChromeTabWithId[];
  for (const tab of tabs) {
    chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, files: ["js/content_script.js"] });
  }

  // Misc.openDummyTab();
}

export async function onMessage(
  activeWindow: Types.ActiveWindow,
  message: any,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response?: any) => void
) {
  const myLogger = logger.getNestedLogger("onMessage");
  if (!message || !message.type) {
    myLogger.warn("message is not valid:", message);
    return;
  }

  myLogger.log(`message:`, message);

  try {
    if (message.type === "pageFocused") {
      if (!sender.tab || sender.tab.id === undefined) {
        myLogger.warn("pageFocused::sender.tab is not valid:", sender);
        return;
      }

      await ActiveWindowEvents.onPageFocused(activeWindow, sender.tab.id);
    } else if (message.type === "getActiveWindow") {
      const { windowId } = message.data as { windowId: ChromeWindowId };
      const activeWindow = await ActiveWindow.get(windowId);
      sendResponse({ activeWindow });
    } else if (message.type === "updateActiveWindow") {
      const { windowId, updateProps } = message.data as { windowId: Types.ActiveWindow["windowId"]; updateProps: Partial<Types.ActiveWindow> };
      const updatedActiveWindow = await ActiveWindow.update(windowId, updateProps);
      sendResponse({ activeWindow: updatedActiveWindow });
    }
  } catch (error) {
    const errorMessage = myLogger.getPrefixedMessage(`error processing message:${error}`);
    sendResponse({ error: errorMessage });
    throw new Error(errorMessage);
  }
}
