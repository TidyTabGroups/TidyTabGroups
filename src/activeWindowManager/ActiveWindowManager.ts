import { ActiveWindow } from "../model";
import * as ActiveWindowMethods from "./ActiveWindowMethods";
import { ChromeTabGroupChangeInfo, ChromeTabGroupId, ChromeTabId, ChromeTabWithId, ChromeWindowId } from "../types/types";
import ChromeWindowHelper from "../chromeWindowHelper";
import Logger from "../logger";
import Types from "../types";
import Storage from "../storage";
import * as ActiveWindowEventHandlers from "./ActiveWindowEventHandlers";
import MouseInPageTracker from "../mouseInPageTracker";
import Misc from "../misc";

const logger = Logger.createLogger("ActiveWindowManager", { color: "#fcba03" });

export async function initialize(onError: (message: string) => void) {
  let asyncInitializationSteps = new Promise<void>(async (resolve, reject) => {
    const myLogger = logger.createNestedLogger("initialize::asyncInitializationSteps");
    try {
      await MouseInPageTracker.initialize();
      MouseInPageTracker.addOnChangeListener((status, tab: ChromeTabWithId) => {
        queueOperationIfWindowIsActive(
          async (activeWindow) => {
            const tabUpToDate = await ChromeWindowHelper.getIfTabExists(tab.id);
            if (!tabUpToDate) {
              return;
            }

            await ActiveWindowEventHandlers.onMouseInPageStatusChanged(activeWindow, tabUpToDate, status);
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
    if (userPreferences === undefined) {
      return;
    }

    if (!userPreferences.oldValue.collapseUnfocusedTabGroups && userPreferences.newValue.collapseUnfocusedTabGroups) {
      queueOperation(
        {
          name: "onEnabledCollapseUnfocusedTabGroups",
          operation: ActiveWindowEventHandlers.onEnabledCollapseUnfocusedTabGroups,
        },
        false
      );
    }

    if (!userPreferences.oldValue.alwaysGroupTabs && userPreferences.newValue.alwaysGroupTabs) {
      queueOperation(
        {
          name: "onEnabledAlwaysGroupTabs",
          operation: ActiveWindowEventHandlers.onEnabledAlwaysGroupTabs,
        },
        false
      );
    }
  });

  chrome.runtime.onInstalled.addListener((details: chrome.runtime.InstalledDetails) => {
    queueOperation({ name: "onInstalled", operation: () => onInstalled(details) }, true);
  });

  chrome.windows.onCreated.addListener((window: chrome.windows.Window) => {
    const myLogger = logger.createNestedLogger("windows.onCreated");
    const windowId = window.id;
    if (windowId === undefined || window.type !== "normal") {
      return;
    }

    queueOperation(
      {
        name: myLogger.getPrefixedMessage("onWindowCreated"),
        operation: async () => {
          const window = await ChromeWindowHelper.getIfWindowExists(windowId);
          if (!window) {
            return;
          }
          await ActiveWindowEventHandlers.onWindowCreated(window);
        },
      },
      true
    );
  });

  chrome.windows.onRemoved.addListener((windowId: ChromeWindowId) => {
    queueOperationIfWindowIsActive(ActiveWindowEventHandlers.onWindowRemoved, windowId, true, "onWindowRemoved");
  });

  chrome.windows.onFocusChanged.addListener((windowId: ChromeWindowId) => {
    const myLogger = logger.createNestedLogger("windows.onFocusChanged");
    queueOperation(
      {
        name: myLogger.getPrefixedMessage("onFocusChanged"),
        operation: () => ActiveWindowEventHandlers.onWindowFocusChanged(windowId),
      },
      false
    );
  });

  chrome.tabGroups.onCreated.addListener((tabGroup: chrome.tabGroups.TabGroup) => {
    const myLogger = logger.createNestedLogger("tabGroups.onCreated");
    queueOperationIfWindowIsActive(
      async (activeWindow) => {
        const tabGroupUpToDate = await ChromeWindowHelper.getIfTabGroupExists(tabGroup.id);
        if (!tabGroupUpToDate) {
          return;
        }
        return ActiveWindowEventHandlers.onTabGroupCreated(activeWindow, tabGroupUpToDate);
      },
      tabGroup.windowId,
      false,
      myLogger.getPrefixedMessage("onTabGroupCreated")
    );
  });

  chrome.tabGroups.onRemoved.addListener((tabGroup: chrome.tabGroups.TabGroup) => {
    const myLogger = logger.createNestedLogger("tabGroups.onRemoved");
    queueOperationIfWindowIsActive(
      (activeWindow) => ActiveWindowEventHandlers.onTabGroupRemoved(activeWindow, tabGroup),
      tabGroup.windowId,
      false,
      myLogger.getPrefixedMessage("onTabGroupRemoved")
    );
  });

  chrome.tabGroups.onUpdated.addListener((tabGroup: chrome.tabGroups.TabGroup) => {
    const myLogger = logger.createNestedLogger("tabGroups.onUpdated");
    queueOperationIfWindowIsActive(
      async (activeWindow) => {
        let tabGroupUpToDate = await ChromeWindowHelper.getIfTabGroupExists(tabGroup.id);
        if (!tabGroupUpToDate) {
          return;
        }

        const isTabGroupUpToDate = Misc.tabGroupEquals(tabGroup, tabGroupUpToDate);
        if (!isTabGroupUpToDate) {
          // Let the most up to date onTabGroupUpdated event handle this operation
          return;
        }

        const activeWindowTabGroup = await ActiveWindow.getActiveWindowTabGroup(tabGroup.windowId, tabGroup.id);
        if (!activeWindowTabGroup) {
          myLogger.warn(
            `activeWindowTabGroup not found. tabGroup.id: ${tabGroup.id}, tabGroup.title: ${tabGroup.title}, windowId: ${tabGroup.windowId}`
          );
          return;
        }

        const changeInfo: ChromeTabGroupChangeInfo = {
          collapsed: tabGroup.collapsed !== activeWindowTabGroup.collapsed ? tabGroup.collapsed : undefined,
          title: tabGroup.title !== activeWindowTabGroup.title ? tabGroup.title : undefined,
          color: tabGroup.color !== activeWindowTabGroup.color ? tabGroup.color : undefined,
        };

        await ActiveWindowEventHandlers.onTabGroupUpdated(activeWindow, activeWindowTabGroup, tabGroup, changeInfo);
      },
      tabGroup.windowId,
      false,
      myLogger.getPrefixedMessage("onTabGroupUpdated")
    );
  });

  chrome.tabs.onCreated.addListener((tab: chrome.tabs.Tab) => {
    const myLogger = logger.createNestedLogger("tabs.onCreated");
    const tabId = tab.id;
    if (tabId === undefined) {
      return;
    }

    queueOperation(
      {
        name: myLogger.getPrefixedMessage("onTabCreated"),
        operation: async () => {
          const myMyLogger = myLogger.createNestedLogger("onTabCreated");
          myMyLogger.log(`tab.title: '${tab.title}', tab.groupId: ${tab.groupId}:`);
          return ActiveWindowEventHandlers.onTabCreated(tabId);
        },
      },
      false
    );
  });

  chrome.tabs.onActivated.addListener((activeInfo: chrome.tabs.TabActiveInfo) => {
    const myLogger = logger.createNestedLogger("tabs.onActivated");
    queueOperation(
      {
        name: myLogger.getPrefixedMessage("onTabActivated"),
        operation: async () => {
          const myMyLogger = myLogger.createNestedLogger("onTabActivated");
          myMyLogger.log("activeInfo", activeInfo);

          await ActiveWindowEventHandlers.onTabActivated(activeInfo.tabId);
        },
      },
      false
    );
  });

  chrome.tabs.onUpdated.addListener((tabId: ChromeTabId, changeInfo: chrome.tabs.TabChangeInfo, tab: chrome.tabs.Tab) => {
    const myLogger = logger.createNestedLogger("tabs.onUpdated");
    // only handle these changeInfo properties
    const validChangeInfo: Array<keyof chrome.tabs.TabChangeInfo> = ["groupId", "title", "pinned"];
    if (!validChangeInfo.find((key) => changeInfo[key] !== undefined)) {
      return;
    }

    queueOperation(
      {
        name: myLogger.getPrefixedMessage("onTabUpdated"),
        operation: async () => {
          const myMyLogger = myLogger.createNestedLogger("onTabUpdated");
          myMyLogger.log(`id: ${tab.id}, title: ${tab.title}, changeInfo: ${changeInfo}`);

          await ActiveWindowEventHandlers.onTabUpdated(tabId, changeInfo);
        },
      },
      false
    );
  });

  chrome.tabs.onRemoved.addListener((tabId: ChromeTabId, removeInfo: chrome.tabs.TabRemoveInfo) => {
    const myLogger = logger.createNestedLogger("tabs.onRemoved");
    queueOperationIfWindowIsActive(
      async (activeWindow) => {
        const myMyLogger = myLogger.createNestedLogger("onTabRemoved");
        myMyLogger.log(`tabId: ${tabId}, removeInfo: `, removeInfo);

        await ActiveWindowEventHandlers.onTabRemoved(activeWindow, tabId, removeInfo);
      },
      removeInfo.windowId,
      false,
      myLogger.getPrefixedMessage("onTabRemoved")
    );
  });

  chrome.tabs.onAttached.addListener((tabId: ChromeTabId, attachInfo: chrome.tabs.TabAttachInfo) => {
    const myLogger = logger.createNestedLogger("tabs.onAttached");
    queueOperation(
      {
        name: myLogger.getPrefixedMessage("onTabAttached"),
        operation: async () => {
          const myMyLogger = myLogger.createNestedLogger("onTabAttached");
          myMyLogger.log(`tab.id: '${tabId}', attachInfo.newWindowId: ${attachInfo.newWindowId}`);
          await ActiveWindowEventHandlers.onTabAttached(tabId, attachInfo);
        },
      },
      false
    );
  });

  chrome.tabs.onDetached.addListener((tabId: ChromeTabId, detachInfo: chrome.tabs.TabDetachInfo) => {
    const myLogger = logger.createNestedLogger("tabs.onDetached");
    queueOperationIfWindowIsActive(
      async (activeWindow) => {
        const myMyLogger = myLogger.createNestedLogger("onTabDetached");
        myMyLogger.log(`tabId: ${tabId}, detachInfo.oldWindowId: ${detachInfo.oldWindowId}`);

        await ActiveWindowEventHandlers.onTabDetached(activeWindow, tabId);
      },
      detachInfo.oldWindowId,
      false,
      myLogger.getPrefixedMessage("onTabDetached")
    );
  });

  chrome.runtime.onMessage.addListener((message: any, sender: chrome.runtime.MessageSender, sendResponse: (response?: any) => void) => {
    const myLogger = logger.createNestedLogger("onMessage");
    if (!message || !message.type) {
      myLogger.warn(`message is not valid - message: ${message}, sender: ${sender}`);
      return;
    }

    myLogger.log(`message:`, message);

    const messageTypes = [
      "getActiveWindow",
      "updateActiveWindow",
      "onChangeKeepTabGroupOpen",
      "getActiveWindowTabGroup",
      "onChangeFocusMode",
      "onChangeActivateCurrentWindow",
    ];
    if (!messageTypes.includes(message.type)) {
      return;
    }

    queueOperation(
      {
        name: myLogger.getPrefixedMessage("onMessage"),
        operation: async () => {
          try {
            if (message.type === messageTypes[0]) {
              const { windowId } = message.data as { windowId: ChromeWindowId };
              const activeWindow = await ActiveWindow.get(windowId);
              sendResponse({ data: { activeWindow } });
            } else if (message.type === messageTypes[1]) {
              const { windowId, updateProps } = message.data as {
                windowId: Types.ActiveWindow["windowId"];
                updateProps: Partial<Types.ActiveWindow>;
              };
              const updatedActiveWindow = await ActiveWindow.update(windowId, updateProps);
              sendResponse({ activeWindow: updatedActiveWindow });
            } else if (message.type === messageTypes[2]) {
              const { windowId, tabGroupId, enabled } = message.data as {
                windowId: ChromeWindowId;
                tabGroupId: ChromeTabGroupId;
                enabled: boolean;
              };
              const activeWindowTabGroup = await ActiveWindowEventHandlers.onChangeKeepTabGroupOpen(windowId, tabGroupId, enabled);
              sendResponse({ data: { activeWindowTabGroup } });
            } else if (message.type === messageTypes[3]) {
              const { windowId, tabGroupId } = message.data as { windowId: ChromeWindowId; tabGroupId: ChromeTabGroupId };
              const activeWindowTabGroup = await ActiveWindow.getActiveWindowTabGroup(windowId, tabGroupId);
              sendResponse({ data: { activeWindowTabGroup } });
            } else if (message.type === messageTypes[4]) {
              const { windowId, enabled } = message.data as { windowId: ChromeWindowId; enabled: boolean };
              const activeWindow = await ActiveWindowEventHandlers.onChangeFocusMode(windowId, enabled);
              sendResponse({ data: { activeWindow } });
            } else if (message.type === messageTypes[5]) {
              const { windowId, enabled } = message.data as { windowId: ChromeWindowId; enabled: boolean };
              const activeWindow = await ActiveWindowEventHandlers.onChangeActivateCurrentWindow(windowId, enabled);
              sendResponse({ data: { activeWindow } });
            } else {
              throw new Error("message type is invalid");
            }
          } catch (error) {
            const errorMessage = myLogger.getPrefixedMessage(`error processing message:${error}`);
            sendResponse({ error: errorMessage });
            throw new Error(errorMessage);
          }
        },
      },
      true
    );

    // return true for the asynchronous response
    return true;
  });

  type ActiveWindowQueuedEventOperation = (activeWindow: Types.ActiveWindow) => Promise<void>;
  type QueuedEventOperation = { name: string; operation: () => Promise<void> };
  let operationQueue: QueuedEventOperation[] = [];
  let isProcessingQueue = false;
  let isQueueSuspended = false;

  function queueOperationIfWindowIsActive(
    operation: ActiveWindowQueuedEventOperation,
    windowIdOrPromisedWindowId: ChromeWindowId | Promise<ChromeWindowId>,
    next: boolean,
    name: string
  ) {
    const myLogger = logger.createNestedLogger("queueOperationIfWindowIsActive");
    queueOperation(
      {
        name,
        operation: async () => {
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
        },
      },
      next
    );
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
    const myLogger = logger.createNestedLogger("processQueue");
    if (isProcessingQueue) {
      throw new Error("processQueue::Queue is already being processed");
    }

    try {
      await asyncInitializationSteps;
    } catch (error) {
      const errorMessage = myLogger.getPrefixedMessage(`Error during asyncInitializationSteps: ${Misc.getErrorMessage(error)}`);
      onBackgroundEventError(errorMessage);
      return;
    }

    isProcessingQueue = true;
    while (operationQueue.length > 0 && !isQueueSuspended) {
      const currentOperation = operationQueue.shift();
      if (currentOperation) {
        const operationTimeoutId = setTimeout(() => {
          onBackgroundEventError(`processQueue::Operation timed out: ${currentOperation.name}`);
        }, 7500);
        try {
          await currentOperation.operation();
        } catch (error) {
          const errorMessage = myLogger.getPrefixedMessage(
            `processQueue::Error processing operation: ${currentOperation.name}: ${Misc.getErrorMessage(error)}`
          );
          onBackgroundEventError(errorMessage);
        } finally {
          clearTimeout(operationTimeoutId);
        }
      }
    }
    isProcessingQueue = false;
  }

  function onBackgroundEventError(message: string) {
    isQueueSuspended = true;
    onError(message);
  }
}

export async function onInstalled(details: chrome.runtime.InstalledDetails) {
  logger.log(`onInstalled::Extension was installed because of: ${details.reason}`);
  if (details.reason === "install") {
    // TODO: open the onboarding page
    await ActiveWindowMethods.activateAllWindows();
  } else {
    await ActiveWindowMethods.reactivateAllWindows();
  }

  // inject the content script into all tabs
  const tabs = (await chrome.tabs.query({})) as ChromeTabWithId[];
  for (const tab of tabs) {
    chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, files: ["js/vendor.js", "js/content_script.js"] });
  }
}
