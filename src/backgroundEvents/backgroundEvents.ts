import { ActiveWindow } from "../model";
import {
  ChromeTabGroupId,
  ChromeTabGroupWithId,
  ChromeTabId,
  ChromeTabWithId,
  ChromeWindowId,
  LastActiveTabInfo,
  PrimaryTabActivationTimeoutInfo,
  LastGroupedTabInfo,
  ChromeWindowWithId,
} from "../types/types";
import ChromeWindowHelper from "../chromeWindowHelper";
import Misc from "../misc";
import Logger from "../logger";
import Types from "../types";

const logger = Logger.getLogger("backgroundEvents", { color: "#fcba03" });

const awokenTime = new Date();
function justWokeUp() {
  return new Date().getTime() - awokenTime.getTime() < 500;
}

export async function initialize(onError: () => void) {
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

  chrome.runtime.onMessage.addListener((message: any, sender: chrome.runtime.MessageSender, sendResponse: (response?: any) => void) => {
    if (!sender.tab) {
      logger.warn("onMessage::sender.tab is not valid:", sender);
      return;
    }
    queueOperationIfWindowIsActive((activeWindow) => onMessage(activeWindow, message, sender, sendResponse), sender.tab.windowId, false);
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

  chrome.tabGroups.onUpdated.addListener((tabGroup: chrome.tabGroups.TabGroup) => {
    queueOperationIfWindowIsActive((activeWindow) => onTabGroupsUpdated(activeWindow, tabGroup), tabGroup.windowId, false);
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
      logger.error("onError::error reactivating all windows:", error);
      onError();
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
      // 2. if the tab is awaiting a primary tab activation, set it as the primary tab
      const { tab } = sender;
      if (!tab || !tab.id) {
        myLogger.warn("pageFocused::sender.tab is not valid:", sender);
        return;
      }

      if (tab.pinned) {
        myLogger.warn("pageFocused::tab is pinned:", tab);
        return;
      }

      if (activeWindow.primaryTabActivationInfo) {
        if (activeWindow.primaryTabActivationInfo.tabId === tab.id) {
          await ActiveWindow.triggerPrimaryTabActivation(tab.windowId, tab.id);
        } else {
          myLogger.warn("pageFocused::tab is not the primary tab:", tab, activeWindow.primaryTabActivationInfo);
        }
      }
    }
  } catch (error) {
    throw new Error(myLogger.getPrefixedMessage(`error processing message:${error}`));
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

export async function onTabGroupsUpdated(activeWindow: Types.ActiveWindow, tabGroup: chrome.tabGroups.TabGroup) {
  const myLogger = logger.getNestedLogger("onTabGroupsUpdated");
  // 1. adjust the window's primary tab activation for this event
  // if the tab group is collapsed:
  //   2. update the active window's non-primary tab group color
  // if the tab group is uncollapsed:
  //   3. update the active window's primary tab group color
  //   4. focus the tab group
  //   if the active tab isnt already in this group:
  //     5. activate the last tab in the group
  myLogger.log(`tabGroup:`, tabGroup.id, tabGroup.title, tabGroup.collapsed, tabGroup.color);
  try {
    // This is a workaround for when Chrome restores a window and fires a bunch of tabGroup.onUpdated events with these "psuedo" tab groups.
    // Note, for this to work, it relies on the fact that this is code path is async.
    const tabGroupsWithSameTitle = await chrome.tabGroups.query({ windowId: tabGroup.windowId, title: tabGroup.title });
    const tabGroupWithSameTitleAndId = tabGroupsWithSameTitle.find((otherTabGroup) => otherTabGroup.id === tabGroup.id);
    if (!tabGroupWithSameTitleAndId) {
      myLogger.warn(`tab group with same title and id not found for windowId:`, tabGroup.windowId, tabGroup.id);
      return;
    }

    // 1
    await ActiveWindow.clearOrRestartOrStartNewPrimaryTabActivationForTabEvent(tabGroup.windowId, -1, false, false, false);

    const { tabGroupHighlightColors } = activeWindow;
    if (tabGroup.collapsed) {
      // 2
      if (tabGroupHighlightColors && tabGroupHighlightColors.nonPrimary !== tabGroup.color) {
        Logger.attentionLogger.log(tabGroupHighlightColors.nonPrimary, tabGroup.color);
        await ActiveWindow.update(tabGroup.windowId, { tabGroupHighlightColors: { ...tabGroupHighlightColors, nonPrimary: tabGroup.color } });
        // update the color of all other non-primary tab groups
        const tabGroups = await chrome.tabGroups.query({ windowId: tabGroup.windowId, collapsed: true });
        const otherTabGroups = tabGroups.filter((otherTabGroup) => otherTabGroup.id !== tabGroup.id);
        await Promise.all(otherTabGroups.map((otherTabGroup) => ChromeWindowHelper.updateTabGroup(otherTabGroup.id, { color: tabGroup.color })));
      }
    } else {
      // 3
      if (tabGroupHighlightColors) {
        if (tabGroupHighlightColors.nonPrimary == tabGroup.color) {
        } else if (tabGroupHighlightColors.primary !== tabGroup.color) {
          await ActiveWindow.update(tabGroup.windowId, { tabGroupHighlightColors: { ...tabGroupHighlightColors, primary: tabGroup.color } });
        }
      }

      // 4
      await ActiveWindow.focusTabGroup(tabGroup.windowId, tabGroup.id);

      const tabs = (await chrome.tabs.query({ windowId: tabGroup.windowId })) as ChromeTabWithId[];
      const tabsInGroup = tabs.filter((tab) => tab.groupId === tabGroup.id);
      const activeTabInGroup = tabsInGroup.find((tab) => tab.active);
      if (!activeTabInGroup) {
        // 5
        const lastTabInGroup = tabsInGroup[tabsInGroup.length - 1];

        // start loading the tab now (before waiting for the animations to finish)
        if (lastTabInGroup.status === "unloaded") {
          chrome.tabs.update(lastTabInGroup.id, { url: lastTabInGroup.url }).catch((error) => myLogger.error(`error discarding tab:${error}`));
        }
        // wait for the tab group uncollapse animations to finish before activatiing the last tab in the group
        const timeToWaitBeforeActivation = justWokeUp() ? 100 : 250;
        await Misc.waitMs(timeToWaitBeforeActivation);
        await ChromeWindowHelper.activateTabAndWait(lastTabInGroup.id);
      }
    }
  } catch (error) {
    throw new Error(myLogger.getPrefixedMessage(`error:${error}`));
  }
}

// FIXME: this needs to handle the case where the active tab is being dragged
export async function onTabActivated(activeWindow: Types.ActiveWindow, activeInfo: chrome.tabs.TabActiveInfo) {
  const myLogger = logger.getNestedLogger("onTabActivated");
  // 1. adjust the window's primary tab activation for this event
  // 2. update the activeWindow's lastActiveTabInfo

  myLogger.log(``, activeInfo.tabId);

  try {
    const tab = await ChromeWindowHelper.getIfTabExists(activeInfo.tabId);
    if (!tab || !tab.id) {
      myLogger.warn(`tab not found for tabId:`, activeInfo.tabId);
      return;
    }

    myLogger.log(`title and groupId:`, tab.title, tab.groupId);

    // 1
    await ActiveWindow.clearOrRestartOrStartNewPrimaryTabActivationForTabEvent(tab.windowId, tab.id, tab.active, tab.pinned, false);

    // 2
    await ActiveWindow.update(tab.windowId, { lastActiveTabInfo: { tabId: tab.id, tabGroupId: tab.groupId, title: tab.title } });
  } catch (error) {
    throw new Error(myLogger.getPrefixedMessage(`error:${error}`));
  }
}

export async function onTabCreated(activeWindow: Types.ActiveWindow, tab: chrome.tabs.Tab) {
  const myLogger = logger.getNestedLogger("onTabCreated");
  // 1. if the tab isnt active and it's position is after the tab awaiting a primary tab activation, cancel the primary tab activation
  // 2. if the tab is not in a group, and the last active tab was in a group, add the tab to the last active tab group
  myLogger.log(`tab:`, tab.title, tab.groupId);

  if (!tab.id) {
    myLogger.warn(`tabId not found for tab:`, tab);
    return;
  }

  try {
    let { lastActiveTabInfo: previousLastActiveTabInfo, primaryTabActivationInfo } = activeWindow;
    const primaryTabActivationTab = primaryTabActivationInfo ? await ChromeWindowHelper.getIfTabExists(primaryTabActivationInfo.tabId) : undefined;
    if (primaryTabActivationInfo && !primaryTabActivationTab) {
      myLogger.warn(`primaryTabActivationTab not found. Tab id:`, primaryTabActivationInfo.tabId);
      primaryTabActivationInfo = null;
    }

    // 1
    if (!tab.active && primaryTabActivationTab && tab.index > primaryTabActivationTab.index) {
      myLogger.log(`clearing primary tab activation for last active tab:`, primaryTabActivationTab.id, primaryTabActivationTab.title);
      await ActiveWindow.clearPrimaryTabActivation(activeWindow.windowId);
    }

    // 2
    // check if the the tab was updated or removed
    const latestTab = await ChromeWindowHelper.getIfTabExists(tab.id);
    if (!latestTab || !latestTab.id) {
      myLogger.warn(`latestTab not found for tabId:`, tab.id);
      return;
    }
    tab = latestTab;

    if (
      !tab.pinned &&
      tab.groupId === chrome.tabGroups.TAB_GROUP_ID_NONE &&
      previousLastActiveTabInfo.tabGroupId !== chrome.tabGroups.TAB_GROUP_ID_NONE
    ) {
      myLogger.log(`adding created tab '${tab.title}' to last active tab group: '${previousLastActiveTabInfo.title}'`);
      await chrome.tabs.group({ tabIds: tab.id, groupId: previousLastActiveTabInfo.tabGroupId });
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
  const myLogger = logger.getNestedLogger("onTabUpdated");
  if (!tab.id) {
    myLogger.warn(`tabId not found for tab:`, tab);
    return;
  }

  const validChangeInfo: Array<keyof chrome.tabs.TabChangeInfo> = ["groupId"];
  if (!validChangeInfo.find((key) => changeInfo[key] !== undefined)) {
    return;
  }

  // 1. if the groupId property is updated:
  //  a. adjust the window's primary tab activation for this event
  //  b. update the activeWindow's lastActiveTabInfo's groupId property

  myLogger.log(`title, changeInfo and id:`, tab.title, changeInfo, tab.id);

  try {
    const previousLastActiveTabInfo = activeWindow.lastActiveTabInfo;

    // 1
    // we check if the tab still exists because the chrome.tabs.onUpdated event gets called with groupId = -1 when the tab
    //  is removed, in which case we dont care about this event for the current use cases
    if (changeInfo.groupId !== undefined && (await ChromeWindowHelper.doesTabExist(tabId))) {
      // 1.a
      await ActiveWindow.clearOrRestartOrStartNewPrimaryTabActivationForTabEvent(activeWindow.windowId, tab.id, tab.active, tab.pinned, false);

      // 1.b
      if (previousLastActiveTabInfo?.tabId === tabId) {
        ActiveWindow.update(activeWindow.windowId, { lastActiveTabInfo: { ...previousLastActiveTabInfo, tabGroupId: changeInfo.groupId } });
      }
    }
  } catch (error) {
    throw new Error(myLogger.getPrefixedMessage(`error:${error}`));
  }
}

export async function onTabRemoved(activeWindow: Types.ActiveWindow, tabId: ChromeTabId, removeInfo: chrome.tabs.TabRemoveInfo) {
  const myLogger = logger.getNestedLogger("onTabRemoved");
  // 1. adjust the window's primary tab activation for this event
  myLogger.log(`tabId:`, tabId, removeInfo);
  try {
    await ActiveWindow.clearOrRestartOrStartNewPrimaryTabActivationForTabEvent(removeInfo.windowId, -1, false, false, true);

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
  // 1. adjust the window's primary tab activation for this event
  myLogger.log(`tabId and moveInfo:`, tabId, moveInfo);

  try {
    const tab = await ChromeWindowHelper.getIfTabExists(tabId);
    if (!tab || !tab.id) {
      myLogger.warn(`tab not found for tabId:`, tabId);
      return;
    }

    myLogger.log(`title and groupId:`, tab.title, tab.groupId);

    // 1
    await ActiveWindow.clearOrRestartOrStartNewPrimaryTabActivationForTabEvent(moveInfo.windowId, tab.id, tab.active, tab.pinned, false);
  } catch (error) {
    throw new Error(myLogger.getPrefixedMessage(`error:${error}`));
  }
}

export async function onTabReplaced(activeWindow: Types.ActiveWindow, addedTabId: ChromeTabId, removedTabId: ChromeTabId) {
  const myLogger = logger.getNestedLogger("onTabReplaced");
  // 1. update the activeWindow's primaryTabActivationInfo's tabId property
  // 2. update the activeWindow's lastActiveTabInfo's tabId property
  myLogger.log(`addedTabId and removedTabId:`, addedTabId, removedTabId);

  try {
    let addedTab = await ChromeWindowHelper.getIfTabExists(addedTabId);
    if (!addedTab || !addedTab.id) {
      myLogger.warn(`addedTab not found for addedTabId:`, addedTabId);
      return;
    }

    const { lastActiveTabInfo: previousLastActiveTabInfo, primaryTabActivationInfo } = activeWindow;

    const updateProps: { lastActiveTabInfo?: LastActiveTabInfo; primaryTabActivationInfo?: PrimaryTabActivationTimeoutInfo } = {};
    // 1
    if (primaryTabActivationInfo?.tabId === removedTabId) {
      updateProps.primaryTabActivationInfo = { ...primaryTabActivationInfo, tabId: addedTabId };
    }

    // 2
    if (previousLastActiveTabInfo && previousLastActiveTabInfo.tabId === removedTabId) {
      updateProps.lastActiveTabInfo = { ...previousLastActiveTabInfo, tabId: addedTabId };
    }

    ActiveWindow.update(activeWindow.windowId, updateProps);
  } catch (error) {
    throw new Error(myLogger.getPrefixedMessage(`error:${error}`));
  }
}
