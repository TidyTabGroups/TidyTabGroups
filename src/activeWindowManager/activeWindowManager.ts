import { ActiveWindow } from "../model";
import { ChromeTabGroupId, ChromeTabGroupWithId, ChromeTabId, ChromeTabWithId, ChromeWindowId, ChromeWindowWithId } from "../types/types";
import ChromeWindowHelper from "../chromeWindowHelper";
import Misc from "../misc";
import Logger from "../logger";
import Types from "../types";
import * as Storage from "../storage";

const logger = Logger.getLogger("activeWindowManager", { color: "#fcba03" });

const awokenTime = new Date();
function justWokeUp() {
  return new Date().getTime() - awokenTime.getTime() < 500;
}

export async function initialize(onError: (error: any) => void) {
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

    queueOperation(() => onWindowCreated(window as ChromeWindowWithId), true);
  });

  chrome.windows.onRemoved.addListener((windowId: ChromeWindowId) => {
    queueOperationIfWindowIsActive(onWindowRemoved, windowId, true);
  });

  chrome.windows.onFocusChanged.addListener((windowId: ChromeWindowId) => {
    queueOperationIfWindowIsActive(onWindowFocusChanged, windowId, false);
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
    queueOperationIfWindowIsActive((activeWindow) => onMessage(activeWindow, message, sender, sendResponse), windowId, false);
    return true;
  });

  chrome.tabs.onCreated.addListener((tab: chrome.tabs.Tab) => {
    queueOperationIfWindowIsActive((activeWindow) => onTabCreated(activeWindow, tab), tab.windowId, false);
  });

  chrome.tabs.onActivated.addListener((activeInfo: chrome.tabs.TabActiveInfo) => {
    queueOperationIfWindowIsActive((activeWindow) => onTabActivated(activeWindow, activeInfo), activeInfo.windowId, false);
  });

  chrome.tabs.onUpdated.addListener((tabId: ChromeTabId, changeInfo: chrome.tabs.TabChangeInfo, tab: chrome.tabs.Tab) => {
    queueOperationIfWindowIsActive((activeWindow) => onTabUpdated(activeWindow, tabId, changeInfo, tab), tab.windowId, false);
  });

  chrome.tabs.onRemoved.addListener((tabId: ChromeTabId, removeInfo: chrome.tabs.TabRemoveInfo) => {
    queueOperationIfWindowIsActive((activeWindow) => onTabRemoved(activeWindow, tabId, removeInfo), removeInfo.windowId, false);
  });

  chrome.tabs.onMoved.addListener((tabId: ChromeTabId, moveInfo: chrome.tabs.TabMoveInfo) => {
    queueOperationIfWindowIsActive((activeWindow) => onTabMoved(activeWindow, tabId, moveInfo), moveInfo.windowId, false);
  });

  chrome.tabs.onReplaced.addListener((addedTabId: ChromeTabId, removedTabId: ChromeTabId) => {
    queueOperationIfWindowIsActive(
      (activeWindow) => onTabReplaced(activeWindow, addedTabId, removedTabId),
      new Promise(async (resolve, reject) => {
        const addedTab = await ChromeWindowHelper.getIfTabExists(addedTabId);
        if (addedTab?.id !== undefined) {
          resolve(addedTab.windowId);
        } else {
          reject(`onTabReplaced::addedTab not found for addedTabId: ${addedTabId}`);
        }
      }),
      false
    );
  });

  chrome.tabGroups.onCreated.addListener((tabGroup: chrome.tabGroups.TabGroup) => {
    queueOperationIfWindowIsActive((activeWindow) => onTabGroupCreated(activeWindow, tabGroup), tabGroup.windowId, false);
  });

  chrome.tabGroups.onRemoved.addListener((tabGroup: chrome.tabGroups.TabGroup) => {
    queueOperationIfWindowIsActive((activeWindow) => onTabGroupRemoved(activeWindow, tabGroup), tabGroup.windowId, false);
  });

  chrome.tabGroups.onUpdated.addListener((tabGroup: chrome.tabGroups.TabGroup) => {
    queueOperationIfWindowIsActive((activeWindow) => onTabGroupUpdated(activeWindow, tabGroup), tabGroup.windowId, false);
  });

  type ActiveWindowQueuedEventOperation = (activeWindow: Types.ActiveWindow) => Promise<void>;
  type QueuedEventOperation = () => Promise<void>;
  let operationQueue: QueuedEventOperation[] = [];
  let isProcessingQueue = false;

  function queueOperationIfWindowIsActive(
    operation: ActiveWindowQueuedEventOperation,
    windowIdOrPromisedWindowId: ChromeWindowId | Promise<ChromeWindowId>,
    queueNext: boolean
  ) {
    // capture the active window state promise now because it could change by the time the operation is executed
    const getActiveWindowPromise = new Promise<Types.ActiveWindow | undefined>(async (resolve, reject) => {
      try {
        const windowId = await windowIdOrPromisedWindowId;
        const activeWindow = await ActiveWindow.get(windowId);
        resolve(activeWindow);
      } catch (error) {
        reject(error);
      }
    });

    queueOperation(async () => {
      let myActiveWindowAfterQueueStart: Types.ActiveWindow;
      try {
        const windowId = await windowIdOrPromisedWindowId;
        const [activeWindowBeforeQueueStart, activeWindowAfterQueueStart] = await Promise.all([getActiveWindowPromise, ActiveWindow.get(windowId)]);
        if (!activeWindowBeforeQueueStart || !activeWindowAfterQueueStart) {
          logger.warn("queueOperationIfWindowIsActive::activeWindow not found, ignoring operation");
          return;
        }
        myActiveWindowAfterQueueStart = activeWindowAfterQueueStart;
      } catch (error) {
        throw new Error(`queueOperationIfWindowIsActive::error trying to get active window for operation:${error}`);
      }

      await operation(myActiveWindowAfterQueueStart);
    }, queueNext);
  }

  function queueOperation(operation: QueuedEventOperation, queueNext: boolean) {
    if (queueNext) {
      operationQueue.unshift(operation);
    } else {
      operationQueue.push(operation);
    }
    if (!isProcessingQueue) {
      processQueue();
    }
  }

  async function processQueue(): Promise<void> {
    isProcessingQueue = true;
    while (operationQueue.length > 0) {
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

  async function onBackgroundEventError() {
    // reset the process queue
    operationQueue = [];
    isProcessingQueue = false;

    try {
      await ActiveWindow.reactivateAllWindows();
    } catch (error) {
      onError(`error reactivating all windows: ${error}`);
    }
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
      // 1. if the tab is pinned, ignore
      // 2. if the tab is active, set it as the primary tab
      const { tab } = sender;
      if (!tab || !tab.id) {
        myLogger.warn("pageFocused::sender.tab is not valid:", sender);
        return;
      }

      // 1
      if (tab.pinned) {
        myLogger.warn("pageFocused::tab is pinned:", tab);
        return;
      }

      // 2
      if (tab.active) {
        await ActiveWindow.focusTab(tab.windowId, tab.id);
      } else {
        myLogger.warn("pageFocused::tab is not active:", tab);
      }
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

export async function onWindowCreated(window: ChromeWindowWithId) {
  logger.log(`onWindowCreated::window:`, window);

  try {
    const newActiveWindow = await ActiveWindow.activateWindow(window.id);
    logger.log(`onWindowCreated::newActiveWindow:`, newActiveWindow);
  } catch (error) {
    throw new Error(`onWindowCreated::error processing window:${error}`);
  }
}

export async function onWindowRemoved(activeWindow: Types.ActiveWindow) {
  const { windowId } = activeWindow;
  logger.log(`onWindowRemoved::windowId:`, windowId);
  try {
    await ActiveWindow.deactivateWindow(windowId);
    logger.log(`onWindowRemoved::deactivated window:`, windowId);
  } catch (error) {
    throw new Error(`onWindowRemoved::error processing window:${error}`);
  }
}

export async function onWindowFocusChanged(activeWindow: Types.ActiveWindow) {
  const myLogger = Logger.getLogger("onWindowFocusChanged");
  const { windowId } = activeWindow;
  myLogger.log(`windowId: ${windowId}`);
  try {
    let keys: Partial<Types.LocalStorageShape> = {};
    if (activeWindow.focusMode) {
      keys = { ...keys, lastSeenFocusModeColors: activeWindow.focusMode.colors };
    }
    await Storage.setItems({ ...keys, lastFocusedWindowHadFocusMode: activeWindow.focusMode !== null });
  } catch (error) {
    throw new Error(myLogger.getPrefixedMessage(`error:${error}`));
  }
}

export async function onTabGroupCreated(activeWindow: Types.ActiveWindow, tabGroup: chrome.tabGroups.TabGroup) {
  const myLogger = logger.getNestedLogger("onTabGroupCreated");
  // 1. adjust the tab group's color based on the active window's focus mode
  // 2. add the ActiveWindowTabGroup
  myLogger.log(`tabGroup:`, tabGroup.id, tabGroup.title, tabGroup.collapsed, tabGroup.color);
  try {
    // 1
    const [activeTab] = await chrome.tabs.query({ windowId: tabGroup.windowId, active: true });
    if (!activeTab) {
      throw new Error(myLogger.getPrefixedMessage(`could not find activeTab in windowId: ${tabGroup.windowId}`));
    }
    const isFocusedTabGroup = activeTab.groupId === tabGroup.id;
    const { focusMode } = activeWindow;
    if (focusMode) {
      if (isFocusedTabGroup && focusMode.colors.focused !== tabGroup.color) {
        await ChromeWindowHelper.updateTabGroup(tabGroup.id, { color: focusMode.colors.focused });
      } else if (!isFocusedTabGroup && focusMode.colors.nonFocused !== tabGroup.color) {
        await ChromeWindowHelper.updateTabGroup(tabGroup.id, { color: focusMode.colors.nonFocused });
      }
    }

    // 2
    await ActiveWindow.update(activeWindow.windowId, { tabGroups: [...activeWindow.tabGroups, tabGroup] });
  } catch (error) {
    throw new Error(myLogger.getPrefixedMessage(`error:${error}`));
  }
}

export async function onTabGroupRemoved(activeWindow: Types.ActiveWindow, tabGroup: chrome.tabGroups.TabGroup) {
  const myLogger = logger.getNestedLogger("onTabGroupRemoved");
  // 1. remove the ActiveWindowTabGroup
  myLogger.log(`tabGroup:`, tabGroup.id, tabGroup.title, tabGroup.collapsed, tabGroup.color);
  try {
    // 1
    await ActiveWindow.update(activeWindow.windowId, {
      tabGroups: activeWindow.tabGroups.filter((otherTabGroup) => otherTabGroup.id !== tabGroup.id),
    });
  } catch (error) {
    throw new Error(myLogger.getPrefixedMessage(`error:${error}`));
  }
}

export async function onTabGroupUpdated(activeWindow: Types.ActiveWindow, tabGroup: chrome.tabGroups.TabGroup) {
  const myLogger = logger.getNestedLogger("onTabGroupUpdated");
  // 1. handle the case where the tab group is a "psuedo" tab group
  // 2. handle the case where the tab group's focus mode color is overridden
  //      due to a chromium bug when creating new tab groups
  // 3. if the tab group is focused, update the active window's focus mode focused color
  // 4. if the tab group is NOT focused, update the active window's focus mode nonFocused color
  // 5. focus the tab group
  // 6. activate the last active tab in the group
  // 7. update the ActiveWindowTabGroup
  myLogger.log(`tabGroup:`, tabGroup.id, tabGroup.title, tabGroup.collapsed, tabGroup.color);
  try {
    // 1
    // This is a workaround for when Chrome restores a window and fires a bunch of tabGroup.onUpdated events with these "psuedo" tab groups.
    // Note, for this to work, it relies on the fact that this is code path is async.
    const tabGroups = await chrome.tabGroups.query({ windowId: tabGroup.windowId });
    const tabGroupWithSameTitleAndId = tabGroups.find((otherTabGroup) => otherTabGroup.id === tabGroup.id && otherTabGroup.title === tabGroup.title);
    if (!tabGroupWithSameTitleAndId) {
      myLogger.warn(`tab group with same title and id not found for windowId:`, tabGroup.windowId, tabGroup.id);
      return;
    }

    const getUserPreferences = Misc.lazyCall(async () => {
      return (await Storage.getItems("userPreferences")).userPreferences;
    });

    const tabs = (await chrome.tabs.query({ windowId: tabGroup.windowId })) as ChromeTabWithId[];
    const activeTab = tabs.find((tab) => tab.active);
    if (!activeTab) {
      throw new Error(myLogger.getPrefixedMessage(`could not find activeTab in windowId: ${tabGroup.windowId}`));
    }
    const focusedTabGroupId = activeTab.groupId;
    const isFocusedTabGroup = tabGroup.id === focusedTabGroupId;

    const activeWindowTabGroup = activeWindow.tabGroups.find((activeWindowTabGroup) => activeWindowTabGroup.id === tabGroup.id);
    if (!activeWindowTabGroup) {
      throw new Error(myLogger.getPrefixedMessage(`activeWindowTabGroup not found for tabGroup:${tabGroup.id}`));
    }
    const wasCollapsed = tabGroup.collapsed && !activeWindowTabGroup.collapsed;
    const wasExpanded = !tabGroup.collapsed && activeWindowTabGroup.collapsed;
    const wasColorUpdated = tabGroup.color !== activeWindowTabGroup.color;
    const wasTitleUpdated = tabGroup.title !== activeWindowTabGroup.title;

    let { focusMode } = activeWindow;

    if (focusMode && wasColorUpdated) {
      if (wasTitleUpdated) {
        // 2
        // this is a workaround for a chromium bug where updating the title of a newly created tab group
        // causes the color to be reset back to its original (non-focus mode) color. We need to reset back
        // to it's previous color, which is it's respective focus mode color.
        await ChromeWindowHelper.updateTabGroup(tabGroup.id, { color: activeWindowTabGroup.color });
      } else {
        let newFocusModeColors;
        if (isFocusedTabGroup) {
          // 3
          newFocusModeColors = { ...focusMode.colors, focused: tabGroup.color };
        } else {
          // 4
          newFocusModeColors = { ...focusMode.colors, nonFocused: tabGroup.color };
          // this will effectively update the color of all other non-focused tab groups
          await ChromeWindowHelper.focusTabGroup(focusedTabGroupId, tabGroups, {
            collapseUnfocusedTabGroups: false,
            highlightColors: newFocusModeColors,
          });
        }

        if (newFocusModeColors) {
          activeWindow = await ActiveWindow.update(tabGroup.windowId, { focusMode: { ...focusMode, colors: newFocusModeColors } });
          focusMode = activeWindow.focusMode;
          const window = await ChromeWindowHelper.getIfWindowExists(tabGroup.windowId);
          if (window?.focused) {
            await Storage.setItems({ lastSeenFocusModeColors: newFocusModeColors });
          }
        }
      }
    }

    if (wasExpanded) {
      // 5
      await ChromeWindowHelper.focusTabGroup(tabGroup.id, tabGroups, {
        collapseUnfocusedTabGroups: (await getUserPreferences()).collapseUnfocusedTabGroups,
        highlightColors: focusMode?.colors,
      });

      // 6
      if ((await getUserPreferences()).activateTabInFocusedTabGroup) {
        const tabsInGroup = tabs.filter((tab) => tab.groupId === tabGroup.id);
        if (tabsInGroup.length === 0) {
          throw new Error(myLogger.getPrefixedMessage(`no tabs found in tab group:${tabGroup.id}`));
        }

        const lastAccessedTabInTabGroup = ChromeWindowHelper.getLastAccessedTab(tabsInGroup);
        const tabToActivate = lastAccessedTabInTabGroup ? lastAccessedTabInTabGroup : tabsInGroup[tabsInGroup.length - 1];

        // start loading the tab now (before waiting for the animations to finish)
        if (tabToActivate.status === "unloaded") {
          chrome.tabs.update(tabToActivate.id, { url: tabToActivate.url }).catch((error) => myLogger.error(`error discarding tab:${error}`));
        }
        // wait for the tab group uncollapse animations to finish before activatiing the last tab in the group
        const timeToWaitBeforeActivation = justWokeUp() ? 100 : 250;
        await Misc.waitMs(timeToWaitBeforeActivation);
        await ChromeWindowHelper.activateTab(tabToActivate.id);
      }
    }

    // 7
    await ActiveWindow.update(tabGroup.windowId, {
      tabGroups: activeWindow.tabGroups.map((otherTabGroup) => (otherTabGroup.id === tabGroup.id ? tabGroup : otherTabGroup)),
    });
  } catch (error) {
    throw new Error(myLogger.getPrefixedMessage(`error:${error}`));
  }
}

// FIXME: this needs to handle the case where the active tab is being dragged
export async function onTabActivated(activeWindow: Types.ActiveWindow, activeInfo: chrome.tabs.TabActiveInfo) {
  const myLogger = logger.getNestedLogger("onTabActivated");
  // 1. focus the tab's group

  myLogger.log(``, activeInfo.tabId);

  try {
    const tab = await ChromeWindowHelper.getIfTabExists(activeInfo.tabId);
    if (!tab || !tab.id) {
      myLogger.warn(`tab not found for tabId:`, activeInfo.tabId);
      return;
    }

    myLogger.log(`title and groupId:`, tab.title, tab.groupId);

    // 1
    await ChromeWindowHelper.focusTabGroup(tab.groupId, tab.windowId, {
      collapseUnfocusedTabGroups: tab.pinned,
      highlightColors: activeWindow.focusMode?.colors,
    });
  } catch (error) {
    throw new Error(myLogger.getPrefixedMessage(`error:${error}`));
  }
}

export async function onTabCreated(activeWindow: Types.ActiveWindow, tab: chrome.tabs.Tab) {
  const myLogger = logger.getNestedLogger("onTabCreated");
  // 1. if the tab is not in a group, and the last active tab was in a group, add the tab to the last active tab group
  myLogger.log(`tab:`, tab.title, tab.groupId);

  if (!tab.id) {
    myLogger.warn(`tabId not found for tab:`, tab);
    return;
  }

  try {
    // 1
    // check if the the tab was updated or removed
    const latestTab = await ChromeWindowHelper.getIfTabExists(tab.id);
    if (!latestTab || !latestTab.id) {
      myLogger.warn(`latestTab not found for tabId:`, tab.id);
      return;
    }
    tab = latestTab;

    const tabsOrderedByLastAccessed = await ChromeWindowHelper.getTabsOrderedByLastAccessed(tab.windowId);
    let lastActiveTab: ChromeTabWithId | undefined;
    // the last active tab could be this tab if it is activated, in that case, get the previous last active tab
    if (tabsOrderedByLastAccessed[tabsOrderedByLastAccessed.length - 1]?.id === tab.id) {
      lastActiveTab = tabsOrderedByLastAccessed[tabsOrderedByLastAccessed.length - 2] as ChromeTabWithId | undefined;
    } else {
      lastActiveTab = tabsOrderedByLastAccessed[tabsOrderedByLastAccessed.length - 1] as ChromeTabWithId | undefined;
    }

    if (
      !tab.pinned &&
      tab.groupId === chrome.tabGroups.TAB_GROUP_ID_NONE &&
      lastActiveTab &&
      lastActiveTab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE &&
      (await Storage.getItems("userPreferences")).userPreferences.addNewTabToFocusedTabGroup
    ) {
      myLogger.log(`adding created tab '${tab.title}' to last active tab group: '${lastActiveTab.title}'`);
      await chrome.tabs.group({ tabIds: tab.id, groupId: lastActiveTab.groupId });
    }
  } catch (error) {
    throw new Error(myLogger.getPrefixedMessage(`error:${error}`));
  }
}

export async function onTabUpdated(
  activeWindow: Types.ActiveWindow,
  tabId: ChromeTabId,
  changeInfo: chrome.tabs.TabChangeInfo,
  tab: chrome.tabs.Tab
) {
  // 1. filter out events we dont care about using validChangeInfo. This is just for keeping the logs less verbose.
  // 2. check if the tab still exists. This event gets fired even after with groupId set to -1 after the tab is removed.
  // 3. if groupId has changed and tab is active, focus the tab's group

  // 1
  const validChangeInfo: Array<keyof chrome.tabs.TabChangeInfo> = ["groupId", "title"];
  if (!validChangeInfo.find((key) => changeInfo[key] !== undefined)) {
    return;
  }

  const myLogger = logger.getNestedLogger("onTabUpdated");
  myLogger.log(`title, changeInfo and id:`, tab.title, changeInfo, tab.id);

  try {
    // 2
    const tab = await ChromeWindowHelper.getIfTabExists(tabId);
    if (!tab || !tab.id) {
      return;
    }

    if (changeInfo.groupId !== undefined && tab.active) {
      // 3
      await ChromeWindowHelper.focusTabGroup(tab.groupId, tab.windowId, {
        collapseUnfocusedTabGroups: tab.pinned,
        highlightColors: activeWindow.focusMode?.colors,
      });
    }
  } catch (error) {
    throw new Error(myLogger.throwPrefixed(`error:${error}`));
  }
}

export async function onTabRemoved(activeWindow: Types.ActiveWindow, tabId: ChromeTabId, removeInfo: chrome.tabs.TabRemoveInfo) {
  const myLogger = logger.getNestedLogger("onTabRemoved");
  myLogger.log(`tabId:`, tabId, removeInfo);
  try {
    if (removeInfo.isWindowClosing) {
      myLogger.log(`window is closing, nothing to do:`, tabId);
      return;
    }
  } catch (error) {
    throw new Error(myLogger.getPrefixedMessage(`error:${error}`));
  }
}

export async function onTabMoved(activeWindow: Types.ActiveWindow, tabId: ChromeTabId, moveInfo: chrome.tabs.TabMoveInfo) {
  const myLogger = logger.getNestedLogger("onTabMoved");
  myLogger.log(`tabId and moveInfo:`, tabId, moveInfo);

  try {
    const tab = await ChromeWindowHelper.getIfTabExists(tabId);
    if (!tab || !tab.id) {
      myLogger.warn(`tab not found for tabId:`, tabId);
      return;
    }

    myLogger.log(`title and groupId:`, tab.title, tab.groupId);
  } catch (error) {
    throw new Error(myLogger.getPrefixedMessage(`error:${error}`));
  }
}

export async function onTabReplaced(activeWindow: Types.ActiveWindow, addedTabId: ChromeTabId, removedTabId: ChromeTabId) {
  const myLogger = logger.getNestedLogger("onTabReplaced");
  myLogger.log(`addedTabId and removedTabId:`, addedTabId, removedTabId);
}
