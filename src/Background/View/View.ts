import Model from "../Model";
import ViewModel from "../ViewModel";
import { ChromeTabGroupChangeInfo, ChromeTabGroupId, ChromeTabId, ChromeTabWithId, ChromeWindowId } from "../../Shared/Types/Types";
import ChromeWindowMethods from "../../Shared/ChromeWindowMethods";
import Logger from "../../Shared/Logger";
import Types from "../../Shared/Types";
import Storage from "../../Shared/Storage";
import EventHandlers from "./EventHandlers";
import * as MouseInPageTracker from "../MouseInPageTracker";
import Misc from "../../Shared/Misc";

const logger = Logger.createLogger("Background::View", { color: "#fcba03" });

export async function initialize(onError: (message: string) => void) {
  const asyncInitializationSteps = new Promise<void>(async (resolve, reject) => {
    const myLogger = logger.createNestedLogger("initialize::asyncInitializationSteps");
    try {
      await MouseInPageTracker.initialize();
      resolve();
    } catch (error) {
      reject(myLogger.getPrefixedMessage(`error initializing: ${error}`));
    }
  });

  MouseInPageTracker.addOnChangeListener((status, tab: ChromeTabWithId) => {
    queueOperation(
      {
        name: "MouseInPageTracker.addOnChangeListener",
        operation: async () => {
          if (status !== (await MouseInPageTracker.getStatus())) {
            return;
          }

          await EventHandlers.onMouseInPageStatusChanged(tab.id, status);
        },
      },
      false
    );
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
          operation: EventHandlers.onEnabledCollapseUnfocusedTabGroups,
        },
        false
      );
    }

    if (!userPreferences.oldValue.alwaysGroupTabs && userPreferences.newValue.alwaysGroupTabs) {
      queueOperation(
        {
          name: "onEnabledAlwaysGroupTabs",
          operation: EventHandlers.onEnabledAlwaysGroupTabs,
        },
        false
      );
    }

    if (userPreferences.oldValue.highlightPrevActiveTabGroup !== userPreferences.newValue.highlightPrevActiveTabGroup) {
      queueOperation(
        {
          name: "onChangeHighlightPrevActiveTabGroup",
          operation: () => EventHandlers.onChangeHighlightPrevActiveTabGroup(userPreferences.newValue.highlightPrevActiveTabGroup),
        },
        false
      );
    }
  });

  chrome.runtime.onInstalled.addListener((details: chrome.runtime.InstalledDetails) => {
    const myLogger = logger.createNestedLogger("onInstalled");
    myLogger.log("details", details);

    queueOperation({ name: "onInstalled", operation: () => onInstalled(details) }, true);
  });

  chrome.windows.onCreated.addListener((window: chrome.windows.Window) => {
    const myLogger = logger.createNestedLogger("windows.onCreated");
    const windowId = window.id;
    if (windowId === undefined || window.type !== "normal") {
      myLogger.log(`windowId is not valid or window type is not 'normal', ignoring operation: windowId: ${windowId}, window.type: ${window.type}`);
      return;
    }

    myLogger.log(`windowId: ${windowId}`);

    queueOperation(
      {
        name: myLogger.getPrefixedMessage("onWindowCreated"),
        operation: async () => {
          const window = await ChromeWindowMethods.getIfWindowExists(windowId);
          if (!window) {
            return;
          }
          await EventHandlers.onWindowCreated(window);
        },
      },
      true
    );
  });

  chrome.windows.onRemoved.addListener((windowId: ChromeWindowId) => {
    const myLogger = logger.createNestedLogger("windows.onRemoved");
    myLogger.log(`windowId: ${windowId}`);

    queueOperationIfWindowIsActive(EventHandlers.onWindowRemoved, windowId, true, "onWindowRemoved");
  });

  chrome.windows.onFocusChanged.addListener((windowId: ChromeWindowId) => {
    const myLogger = logger.createNestedLogger("windows.onFocusChanged");
    myLogger.log(`windowId: ${windowId}`);

    queueOperation(
      {
        name: myLogger.getPrefixedMessage("onFocusChanged"),
        operation: () => EventHandlers.onWindowFocusChanged(windowId),
      },
      false
    );
  });

  chrome.tabGroups.onCreated.addListener((tabGroup: chrome.tabGroups.TabGroup) => {
    const myLogger = logger.createNestedLogger("tabGroups.onCreated");
    myLogger.log(`tabGroup.title: ${tabGroup.title}, tabGroup.id: ${tabGroup.id}`);

    queueOperationIfWindowIsActive(
      async (activeWindow) => {
        const tabGroupUpToDate = await ChromeWindowMethods.getIfTabGroupExists(tabGroup.id);
        if (!tabGroupUpToDate) {
          return;
        }
        return await EventHandlers.onTabGroupCreated(activeWindow, tabGroupUpToDate);
      },
      tabGroup.windowId,
      false,
      myLogger.getPrefixedMessage("onTabGroupCreated")
    );
  });

  chrome.tabGroups.onRemoved.addListener((tabGroup: chrome.tabGroups.TabGroup) => {
    const myLogger = logger.createNestedLogger("tabGroups.onRemoved");
    myLogger.log(`tabGroup.title: ${tabGroup.title}, tabGroup.id: ${tabGroup.id}`);

    queueOperationIfWindowIsActive(
      (activeWindow) => EventHandlers.onTabGroupRemoved(activeWindow, tabGroup),
      tabGroup.windowId,
      false,
      myLogger.getPrefixedMessage("onTabGroupRemoved")
    );
  });

  chrome.tabGroups.onUpdated.addListener((tabGroup: chrome.tabGroups.TabGroup) => {
    const myLogger = logger.createNestedLogger("tabGroups.onUpdated");
    myLogger.log(`tabGroup.title: ${tabGroup.title}, tabGroup.id: ${tabGroup.id}`);

    queueOperationIfWindowIsActive(
      async (activeWindow) => {
        let tabGroupUpToDate = await ChromeWindowMethods.getIfTabGroupExists(tabGroup.id);
        if (!tabGroupUpToDate) {
          return;
        }

        const isTabGroupUpToDate = Misc.tabGroupEquals(tabGroup, tabGroupUpToDate);
        if (!isTabGroupUpToDate) {
          // Let the most up to date onTabGroupUpdated event handle this operation
          return;
        }

        const activeWindowTabGroup = await Model.getActiveWindowTabGroup(tabGroup.windowId, tabGroup.id);
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

        await EventHandlers.onTabGroupUpdated(activeWindow, activeWindowTabGroup, tabGroup, changeInfo);
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
      myLogger.log(`tabId is not valid, ignoring operation: tabId: ${tabId}`);
      return;
    }

    myLogger.log(`tab.title: '${tab.title}', tab.groupId: ${tab.groupId}`);

    queueOperation(
      {
        name: myLogger.getPrefixedMessage("onTabCreated"),
        operation: async () => {
          const myMyLogger = myLogger.createNestedLogger("onTabCreated");
          myMyLogger.log(`tab.title: '${tab.title}', tab.groupId: ${tab.groupId}:`);

          return await EventHandlers.onTabCreated(tabId);
        },
      },
      false
    );
  });

  chrome.tabs.onActivated.addListener((activeInfo: chrome.tabs.TabActiveInfo) => {
    const myLogger = logger.createNestedLogger("tabs.onActivated");
    myLogger.log("activeInfo.tabId", activeInfo.tabId);

    queueOperation(
      {
        name: myLogger.getPrefixedMessage("onTabActivated"),
        operation: async () => {
          const myMyLogger = myLogger.createNestedLogger("onTabActivated");
          myMyLogger.log("activeInfo", activeInfo);

          await EventHandlers.onTabActivated(activeInfo.tabId);
        },
      },
      false
    );
  });

  chrome.tabs.onUpdated.addListener((tabId: ChromeTabId, changeInfo: chrome.tabs.TabChangeInfo, tab: chrome.tabs.Tab) => {
    // only handle these changeInfo properties
    const validChangeInfo: Array<keyof chrome.tabs.TabChangeInfo> = ["groupId", "title", "pinned"];
    if (!validChangeInfo.find((key) => changeInfo[key] !== undefined)) {
      return;
    }

    const myLogger = logger.createNestedLogger("tabs.onUpdated");
    myLogger.log(`tabId: ${tabId}, title: ${tab.title}, changeInfo: `, changeInfo);

    queueOperation(
      {
        name: myLogger.getPrefixedMessage("onTabUpdated"),
        operation: async () => {
          const myMyLogger = myLogger.createNestedLogger("onTabUpdated");
          myMyLogger.log(`id: ${tab.id}, title: ${tab.title}, changeInfo: ${changeInfo}`);

          await EventHandlers.onTabUpdated(tabId, changeInfo);
        },
      },
      false
    );
  });

  chrome.tabs.onRemoved.addListener((tabId: ChromeTabId, removeInfo: chrome.tabs.TabRemoveInfo) => {
    const myLogger = logger.createNestedLogger("tabs.onRemoved");
    myLogger.log(`tabId: ${tabId}, removeInfo: `, removeInfo);

    queueOperationIfWindowIsActive(
      async (activeWindow) => {
        const myMyLogger = myLogger.createNestedLogger("onTabRemoved");
        myMyLogger.log(`tabId: ${tabId}, removeInfo: `, removeInfo);

        await EventHandlers.onTabRemoved(activeWindow, tabId, removeInfo);
      },
      removeInfo.windowId,
      false,
      myLogger.getPrefixedMessage("onTabRemoved")
    );
  });

  chrome.tabs.onAttached.addListener((tabId: ChromeTabId, attachInfo: chrome.tabs.TabAttachInfo) => {
    const myLogger = logger.createNestedLogger("tabs.onAttached");
    myLogger.log(`tab.id: '${tabId}', attachInfo.newWindowId: ${attachInfo.newWindowId}`);

    queueOperation(
      {
        name: myLogger.getPrefixedMessage("onTabAttached"),
        operation: async () => {
          const myMyLogger = myLogger.createNestedLogger("onTabAttached");
          myMyLogger.log(`tab.id: '${tabId}', attachInfo.newWindowId: ${attachInfo.newWindowId}`);
          await EventHandlers.onTabAttached(tabId, attachInfo);
        },
      },
      false
    );
  });

  chrome.tabs.onDetached.addListener((tabId: ChromeTabId, detachInfo: chrome.tabs.TabDetachInfo) => {
    const myLogger = logger.createNestedLogger("tabs.onDetached");
    myLogger.log(`tabId: ${tabId}, detachInfo.oldWindowId: ${detachInfo.oldWindowId}`);

    queueOperationIfWindowIsActive(
      async (activeWindow) => {
        const myMyLogger = myLogger.createNestedLogger("onTabDetached");
        myMyLogger.log(`tabId: ${tabId}, detachInfo.oldWindowId: ${detachInfo.oldWindowId}`);

        await EventHandlers.onTabDetached(activeWindow, tabId);
      },
      detachInfo.oldWindowId,
      false,
      myLogger.getPrefixedMessage("onTabDetached")
    );
  });

  chrome.runtime.onMessage.addListener((message: any, sender: chrome.runtime.MessageSender, sendResponse: (response?: any) => void) => {
    const myLogger = logger.createNestedLogger("onMessage");
    myLogger.log(`message:`, message);

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
              const activeWindow = await Model.get(windowId);
              sendResponse({ data: { activeWindow } });
            } else if (message.type === messageTypes[1]) {
              const { windowId, updateProps } = message.data as {
                windowId: Types.ActiveWindow["windowId"];
                updateProps: Partial<Types.ActiveWindow>;
              };
              const updatedActiveWindow = await Model.update(windowId, updateProps);
              sendResponse({ activeWindow: updatedActiveWindow });
            } else if (message.type === messageTypes[2]) {
              const { windowId, tabGroupId, enabled } = message.data as {
                windowId: ChromeWindowId;
                tabGroupId: ChromeTabGroupId;
                enabled: boolean;
              };
              const activeWindowTabGroup = await EventHandlers.onChangeKeepTabGroupOpen(windowId, tabGroupId, enabled);
              sendResponse({ data: { activeWindowTabGroup } });
            } else if (message.type === messageTypes[3]) {
              const { windowId, tabGroupId } = message.data as { windowId: ChromeWindowId; tabGroupId: ChromeTabGroupId };
              const activeWindowTabGroup = await Model.getActiveWindowTabGroup(windowId, tabGroupId);
              sendResponse({ data: { activeWindowTabGroup } });
            } else if (message.type === messageTypes[4]) {
              const { windowId, enabled } = message.data as { windowId: ChromeWindowId; enabled: boolean };
              const activeWindow = await EventHandlers.onChangeFocusMode(windowId, enabled);
              sendResponse({ data: { activeWindow } });
            } else if (message.type === messageTypes[5]) {
              const { windowId, enabled } = message.data as { windowId: ChromeWindowId; enabled: boolean };
              const activeWindow = await EventHandlers.onChangeActivateCurrentWindow(windowId, enabled);
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
            const myActiveWindow = await Model.get(windowId);
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

  if (details.reason === "update" && details.previousVersion === "0.0.4") {
    await Storage.updateItems("userPreferences", (prev) => {
      return { userPreferences: { ...prev.userPreferences, repositionTabs: false, repositionTabGroups: false, alwaysGroupTabs: false } };
    });
  }

  if (details.reason === "install") {
    await Misc.waitMs(500);
  }

  await ViewModel.reactivateAllWindows();

  // inject the content script into all tabs
  const tabs = (await chrome.tabs.query({})) as ChromeTabWithId[];
  for (const tab of tabs) {
    chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, files: ["js/vendor.js", "js/content_script.js"] });
  }
}
