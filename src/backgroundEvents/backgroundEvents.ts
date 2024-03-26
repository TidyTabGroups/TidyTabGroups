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
} from "../types/types";
import ChromeWindowHelper from "../chromeWindowHelper";
import Misc from "../misc";
import Logger from "../logger";

const awokenTime = new Date();
function justWokeUp() {
  return new Date().getTime() - awokenTime.getTime() < 500;
}

const logger = Logger.getLogger("backgroundEvents", { color: "#fcba03" });

export async function initialize(onError: () => void) {
  chrome.runtime.onInstalled.addListener((details: chrome.runtime.InstalledDetails) => {
    queueOperation(() => onInstalled(details));
  });
  chrome.runtime.onMessage.addListener((message: any, sender: chrome.runtime.MessageSender, sendResponse: (response?: any) => void) => {
    queueOperation(() => onMessage(message, sender, sendResponse));
  });

  chrome.windows.onCreated.addListener((window: chrome.windows.Window) => {
    queueOperation(() => onWindowCreated(window));
  });

  chrome.windows.onRemoved.addListener((windowId: ChromeWindowId) => {
    queueOperation(() => onWindowRemoved(windowId));
  });

  chrome.tabs.onCreated.addListener((tab: chrome.tabs.Tab) => {
    queueOperation(() => onTabCreated(tab));
  });

  chrome.tabs.onActivated.addListener((activeInfo: chrome.tabs.TabActiveInfo) => {
    queueOperation(() => onTabActivated(activeInfo));
  });

  chrome.tabs.onUpdated.addListener((tabId: ChromeTabId, changeInfo: chrome.tabs.TabChangeInfo, tab: chrome.tabs.Tab) => {
    queueOperation(() => onTabUpdated(tabId, changeInfo, tab));
  });

  chrome.tabs.onRemoved.addListener((tabId: ChromeTabId, removeInfo: chrome.tabs.TabRemoveInfo) => {
    queueOperation(() => onTabRemoved(tabId, removeInfo));
  });

  chrome.tabs.onMoved.addListener((tabId: ChromeTabId, moveInfo: chrome.tabs.TabMoveInfo) => {
    queueOperation(() => onTabMoved(tabId, moveInfo));
  });

  chrome.tabs.onReplaced.addListener((addedTabId: ChromeTabId, removedTabId: ChromeTabId) => {
    queueOperation(() => onTabReplaced(addedTabId, removedTabId));
  });

  chrome.tabGroups.onUpdated.addListener((tabGroup: chrome.tabGroups.TabGroup) => {
    queueOperation(() => onTabGroupsUpdated(tabGroup));
  });

  type AsyncOperation = () => Promise<void>;
  let operationQueue: AsyncOperation[] = [];
  let isProcessingQueue = false;

  function queueOperation(operation: AsyncOperation): void {
    operationQueue.push(operation);
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

export async function onMessage(message: any, sender: chrome.runtime.MessageSender, sendResponse: (response?: any) => void) {
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

      const activeWindowId = await ActiveWindow.getKey(tab.windowId);
      if (!activeWindowId) {
        myLogger.warn("pageFocused::activeWindow not found:", tab.windowId);
        return;
      }

      const activeWindow = await ActiveWindow.getOrThrow(activeWindowId);
      if (activeWindow.primaryTabActivationInfo) {
        if (activeWindow.primaryTabActivationInfo.tabId === tab.id) {
          await ActiveWindow.triggerPrimaryTabActivation(activeWindowId, tab.id);
        } else {
          myLogger.warn("pageFocused::tab is not the primary tab:", tab, activeWindow.primaryTabActivationInfo);
        }
      }
    }
  } catch (error) {
    throw new Error(myLogger.getPrefixedMessage(`error processing message:${error}`));
  }
}

export async function onWindowCreated(window: chrome.windows.Window) {
  if (window.type !== "normal" || !window.id) {
    return;
  }
  logger.log(`onWindowCreated::window:`, window);

  try {
    const newActiveWindow = await ActiveWindow.activateWindow(window.id);
    logger.log(`onWindowCreated::newActiveWindow:`, newActiveWindow);
  } catch (error) {
    throw new Error(`onWindowCreated::error processing window:${error}`);
  }
}

export async function onWindowRemoved(windowId: ChromeWindowId) {
  logger.log(`onWindowRemoved::windowId:`, windowId);

  try {
    if (!(await ActiveWindow.getKey(windowId))) {
      logger.warn(`onWindowRemoved::activeWindow not found for windowId:`, windowId);
      return;
    }

    await ActiveWindow.deactivateWindow(windowId);
    logger.log(`onWindowRemoved::deactivated window:`, windowId);
  } catch (error) {
    throw new Error(`onWindowRemoved::error processing window:${error}`);
  }
}

export async function onTabGroupsUpdated(tabGroup: chrome.tabGroups.TabGroup) {
  const myLogger = logger.getNestedLogger("onTabGroupsUpdated");
  // 1. adjust the window's primary tab activation for this event
  // 2. if the tab group is uncollapsed:
  //   a. collapse all other tab groups
  //   b. if the active tab isnt already in this group, activate the last tab in the group
  myLogger.log(`tabGroup:`, tabGroup.id, tabGroup.title, tabGroup.collapsed);
  try {
    const activeWindowId = await ActiveWindow.getKey(tabGroup.windowId);
    if (!activeWindowId) {
      myLogger.warn(`activeWindow not found for windowId:`, tabGroup.windowId);
      return;
    }

    // This is a workaround for when Chrome restores a window and fires a bunch of tabGroup.onUpdated events with these "psuedo" tab groups.
    // Note, for this to work, it relies on the fact that this is code path is async.
    const tabGroupsWithSameTitle = await chrome.tabGroups.query({ windowId: tabGroup.windowId, title: tabGroup.title });
    const tabGroupWithSameTitleAndId = tabGroupsWithSameTitle.find((otherTabGroup) => otherTabGroup.id === tabGroup.id);
    if (!tabGroupWithSameTitleAndId) {
      myLogger.warn(`tab group with same title and id not found for windowId:`, tabGroup.windowId, tabGroup.id);
      return;
    }

    // 1
    await ActiveWindow.clearOrRestartOrStartNewPrimaryTabActivationForTabEvent(activeWindowId, -1, false, false, false);

    if (!tabGroup.collapsed) {
      // 2.a
      const tabGroups = (await chrome.tabGroups.query({ windowId: tabGroup.windowId, collapsed: false })) as ChromeTabGroupWithId[];
      const otherTabGroups = tabGroups.filter((otherTabGroup) => otherTabGroup.id !== tabGroup.id);
      if (otherTabGroups.length > 0) {
        myLogger.log(`collapsing all other tab groups`);
        await Promise.all(
          otherTabGroups.map(async (otherTabGroup) => {
            await ChromeWindowHelper.updateTabGroupAndWait(otherTabGroup.id, { collapsed: true });
          })
        );
      }

      // 2.b
      const tabs = (await chrome.tabs.query({ windowId: tabGroup.windowId })) as ChromeTabWithId[];
      const tabsInGroup = tabs.filter((tab) => tab.groupId === tabGroup.id);
      const activeTabInGroup = tabsInGroup.find((tab) => tab.active);
      if (!activeTabInGroup) {
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
export async function onTabActivated(activeInfo: chrome.tabs.TabActiveInfo) {
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

    const activeWindowId = await ActiveWindow.getKey(activeInfo.windowId);
    if (!activeWindowId) {
      myLogger.warn(`activeWindow not found for windowId:`, activeInfo.windowId);
      return;
    }

    myLogger.log(`title and groupId:`, tab.title, tab.groupId);

    // 1
    await ActiveWindow.clearOrRestartOrStartNewPrimaryTabActivationForTabEvent(activeWindowId, tab.id, tab.active, tab.pinned, false);

    // 2
    await ActiveWindow.update(activeWindowId, { lastActiveTabInfo: { tabId: tab.id, tabGroupId: tab.groupId, title: tab.title } });
  } catch (error) {
    throw new Error(myLogger.getPrefixedMessage(`error:${error}`));
  }
}

export async function onTabCreated(tab: chrome.tabs.Tab) {
  const myLogger = logger.getNestedLogger("onTabCreated");
  // 1. if the tab isnt active and it's position is after the tab awaiting a primary tab activation, cancel the primary tab activation
  // 2. if the tab is not in a group, and the last active tab was in a group, add the tab to the last active tab group
  myLogger.log(`tab:`, tab.title, tab.groupId);

  if (!tab.id) {
    myLogger.warn(`tabId not found for tab:`, tab);
    return;
  }

  try {
    const activeWindowId = await ActiveWindow.getKey(tab.windowId);
    if (!activeWindowId) {
      myLogger.warn(`activeWindow not found for windowId:`, tab.windowId);
      return;
    }

    const activeWindow = await ActiveWindow.getOrThrow(activeWindowId);
    const { lastActiveTabInfo: previousLastActiveTabInfo, primaryTabActivationInfo } = activeWindow;

    // 1
    if (primaryTabActivationInfo && !tab.active) {
      const primaryTabActivationTab = await ChromeWindowHelper.getIfTabExists(primaryTabActivationInfo.tabId);
      if (primaryTabActivationTab && tab.index > primaryTabActivationTab.index) {
        myLogger.log(`clearing primary tab activation for last active tab:`, primaryTabActivationTab.id, primaryTabActivationTab.title);
        await ActiveWindow.clearPrimaryTabActivation(activeWindowId);
      }
    }

    // 2
    // By now, the the tab's group could have been updated.
    // Note, for this to work, it relies on the fact that this is code path is async
    tab = (await chrome.tabs.get(tab.id)) as ChromeTabWithId;
    if (!tab.id) {
      myLogger.warn(`tabId not found for tab:`, tab);
      return;
    }

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

export async function onTabUpdated(tabId: ChromeTabId, changeInfo: chrome.tabs.TabChangeInfo, tab: chrome.tabs.Tab) {
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
    const activeWindow = await ActiveWindow.get(tab.windowId);
    if (!activeWindow) {
      myLogger.warn(`onTabsUpdated::activeWindow not found for windowId:`, tab.windowId);
      return;
    }

    const previousLastActiveTabInfo = activeWindow.lastActiveTabInfo;

    // 1
    // we check if the tab still exists because the chrome.tabs.onUpdated event gets called with groupId = -1 when the tab
    //  is removed, in which case we dont care about this event for the current use cases
    if (changeInfo.groupId !== undefined && (await ChromeWindowHelper.doesTabExist(tabId))) {
      // 1.a
      await ActiveWindow.clearOrRestartOrStartNewPrimaryTabActivationForTabEvent(activeWindow.windowId, tab.id, tab.active, tab.pinned, false);

      // 1.b
      if (previousLastActiveTabInfo?.tabId === tabId) {
        await ActiveWindow.update(activeWindow.windowId, { lastActiveTabInfo: { ...previousLastActiveTabInfo, tabGroupId: changeInfo.groupId } });
      }
    }
  } catch (error) {
    throw new Error(myLogger.getPrefixedMessage(`error:${error}`));
  }
}

export async function onTabRemoved(tabId: ChromeTabId, removeInfo: chrome.tabs.TabRemoveInfo) {
  const myLogger = logger.getNestedLogger("onTabRemoved");
  // 1. adjust the window's primary tab activation for this event
  myLogger.log(`tabId:`, tabId, removeInfo);
  try {
    const activeWindowId = await ActiveWindow.getKey(removeInfo.windowId);
    if (!activeWindowId) {
      myLogger.warn(`activeWindow not found for windowId:`, removeInfo.windowId);
      return;
    }

    await ActiveWindow.clearOrRestartOrStartNewPrimaryTabActivationForTabEvent(activeWindowId, -1, false, false, true);

    if (removeInfo.isWindowClosing) {
      myLogger.log(`window is closing, nothing to do:`, tabId);
      return;
    }
  } catch (error) {
    throw new Error(myLogger.getPrefixedMessage(`error:${error}`));
  }
}

export async function onTabMoved(tabId: ChromeTabId, moveInfo: chrome.tabs.TabMoveInfo) {
  const myLogger = logger.getNestedLogger("onTabMoved");
  // 1. adjust the window's primary tab activation for this event
  myLogger.log(`tabId and moveInfo:`, tabId, moveInfo);

  try {
    const activeWindowId = await ActiveWindow.getKey(moveInfo.windowId);
    if (!activeWindowId) {
      myLogger.warn(`activeWindow not found for windowId:`, moveInfo.windowId);
      return;
    }

    const tab = await ChromeWindowHelper.getIfTabExists(tabId);
    if (!tab || !tab.id) {
      myLogger.warn(`tab not found for tabId:`, tabId);
      return;
    }

    myLogger.log(`title and groupId:`, tab.title, tab.groupId);

    // 1
    await ActiveWindow.clearOrRestartOrStartNewPrimaryTabActivationForTabEvent(activeWindowId, tab.id, tab.active, tab.pinned, false);
  } catch (error) {
    throw new Error(myLogger.getPrefixedMessage(`error:${error}`));
  }
}

export async function onTabReplaced(addedTabId: ChromeTabId, removedTabId: ChromeTabId) {
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

    const { windowId } = addedTab;

    const activeWindowId = await ActiveWindow.getKey(windowId);
    if (!activeWindowId) {
      myLogger.warn(`activeWindow not found for removedTabId:`, removedTabId);
      return;
    }

    const activeWindow = await ActiveWindow.getOrThrow(activeWindowId);
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

    await ActiveWindow.update(activeWindow.windowId, updateProps);
  } catch (error) {
    throw new Error(myLogger.getPrefixedMessage(`error:${error}`));
  }
}
