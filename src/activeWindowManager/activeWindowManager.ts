import { ActiveWindow } from "../model";
import {
  ActiveWindowTabGroup,
  ChromeTabGroupId,
  ChromeTabGroupWithId,
  ChromeTabId,
  ChromeTabWithId,
  ChromeWindowId,
  ChromeWindowWithId,
} from "../types/types";
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
    queueOperationIfWindowIsActive(onWindowRemoved, windowId, true, "onWindowRemoved");
  });

  chrome.windows.onFocusChanged.addListener((windowId: ChromeWindowId) => {
    queueOperationIfWindowIsActive(onWindowFocusChanged, windowId, false, "onWindowFocusChanged");
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

  chrome.tabs.onCreated.addListener((tab: chrome.tabs.Tab) => {
    queueOperationIfWindowIsActive((activeWindow) => onTabCreated(activeWindow, tab), tab.windowId, false, "onTabCreated");
  });

  chrome.tabs.onActivated.addListener((activeInfo: chrome.tabs.TabActiveInfo) => {
    queueOperationIfWindowIsActive((activeWindow) => onTabActivated(activeWindow, activeInfo), activeInfo.windowId, false, "onTabActivated");
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
      (activeWindow) => onTabUpdated(activeWindow, tabId, changeInfo, tab, getHighlightedTabsPromise),
      tab.windowId,
      false,
      "onTabUpdated"
    );
  });

  chrome.tabs.onRemoved.addListener((tabId: ChromeTabId, removeInfo: chrome.tabs.TabRemoveInfo) => {
    queueOperationIfWindowIsActive((activeWindow) => onTabRemoved(activeWindow, tabId, removeInfo), removeInfo.windowId, false, "onTabRemoved");
  });

  chrome.tabs.onMoved.addListener((tabId: ChromeTabId, moveInfo: chrome.tabs.TabMoveInfo) => {
    queueOperationIfWindowIsActive((activeWindow) => onTabMoved(activeWindow, tabId, moveInfo), moveInfo.windowId, false, "onTabMoved");
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
      false,
      "onTabReplaced"
    );
  });

  chrome.tabGroups.onCreated.addListener((tabGroup: chrome.tabGroups.TabGroup) => {
    queueOperationIfWindowIsActive((activeWindow) => onTabGroupCreated(activeWindow, tabGroup), tabGroup.windowId, false, "onTabGroupCreated");
  });

  chrome.tabGroups.onRemoved.addListener((tabGroup: chrome.tabGroups.TabGroup) => {
    queueOperationIfWindowIsActive((activeWindow) => onTabGroupRemoved(activeWindow, tabGroup), tabGroup.windowId, false, "onTabGroupRemoved");
  });

  chrome.tabGroups.onUpdated.addListener((tabGroup: chrome.tabGroups.TabGroup) => {
    queueOperationIfWindowIsActive((activeWindow) => onTabGroupUpdated(activeWindow, tabGroup), tabGroup.windowId, false, "onTabGroupUpdated");
  });

  type ActiveWindowQueuedEventOperation = (activeWindow: Types.ActiveWindow) => Promise<void>;
  type QueuedEventOperation = () => Promise<void>;
  let operationQueue: QueuedEventOperation[] = [];
  let isProcessingQueue = false;

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
      // 3. if the tab is active and the tab group's useTabTitle is true, update the tab group's title
      if (!sender.tab || sender.tab.id === undefined) {
        myLogger.warn("pageFocused::sender.tab is not valid:", sender);
        return;
      }

      const tabUpToDate = await ChromeWindowHelper.getIfTabExists(sender.tab.id);
      if (!tabUpToDate || !tabUpToDate.id) {
        myLogger.warn("pageFocused::tabUpToDate is not valid:", tabUpToDate);
        return;
      }

      // 1
      if (tabUpToDate.pinned) {
        myLogger.warn("pageFocused::tab is pinned:", tabUpToDate.title);
        return;
      }

      if (tabUpToDate.active) {
        // 2
        await ActiveWindow.focusTab(tabUpToDate.windowId, tabUpToDate.id);
        // 3
        const activeWindowTabGroup = activeWindow.tabGroups.find((activeWindowTabGroup) => activeWindowTabGroup.id === tabUpToDate.groupId);
        if (activeWindowTabGroup?.useTabTitle) {
          const tabGroupUpToDate = await ChromeWindowHelper.updateTabGroup(tabUpToDate.groupId, { title: tabUpToDate.title });
          await ActiveWindow.updateActiveWindowTabGroup(tabUpToDate.windowId, tabUpToDate.groupId, { title: tabGroupUpToDate.title });
        }
      } else {
        myLogger.warn("pageFocused::tab is not active:", tabUpToDate.title);
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
  // 2. if the tab group's title is empty, set the ActiveWindowTabGroup's useTabTitle to true
  // 3. add the ActiveWindowTabGroup
  myLogger.log(`tabGroup:`, tabGroup.id, tabGroup.title, tabGroup.collapsed, tabGroup.color);
  try {
    let tabGroupUpToDate = await ChromeWindowHelper.getIfTabGroupExists(tabGroup.id);
    if (!tabGroupUpToDate) {
      myLogger.warn(`(1) tabGroupUpToDate not found for tabGroup:${tabGroup.id}`);
      return;
    }

    let newActiveWindowTabGroup = { ...tabGroupUpToDate, useTabTitle: false };

    const activeTab = (await chrome.tabs.query({ windowId: tabGroup.windowId, active: true }))[0] as ChromeTabWithId | undefined;

    // 1
    const isFocusedTabGroup = activeTab && activeTab.groupId === tabGroup.id;
    const { focusMode } = activeWindow;
    if (focusMode) {
      if (isFocusedTabGroup && focusMode.colors.focused !== tabGroupUpToDate.color) {
        tabGroupUpToDate = await ChromeWindowHelper.updateTabGroup(tabGroup.id, { color: focusMode.colors.focused });
      } else if (!isFocusedTabGroup && focusMode.colors.nonFocused !== tabGroupUpToDate.color) {
        tabGroupUpToDate = await ChromeWindowHelper.updateTabGroup(tabGroup.id, { color: focusMode.colors.nonFocused });
      }
      newActiveWindowTabGroup.color = tabGroupUpToDate.color;
    }

    // 2
    // TODO: check for `use tab title for blank tab groups` user preference
    const useTabTitle = tabGroupUpToDate.title === undefined || tabGroupUpToDate.title === "";
    if (useTabTitle) {
      // FIXME: remove the timeout workaround once the chromium bug is resolved: https://issues.chromium.org/issues/334965868#comment4
      await Misc.waitMs(30);

      const newTitle = await (async function () {
        const DEFAULT_TITLE = "New Group";
        const tabsInGroup = (await chrome.tabs.query({ windowId: tabGroup.windowId, groupId: tabGroup.id })) as ChromeTabWithId[];
        if (tabsInGroup.length === 0) {
          Logger.attentionLogger.warn("tabsInGroup is empty");
          return DEFAULT_TITLE;
        }

        const tabsInGroupOrderedByLastAccessed = await ChromeWindowHelper.getTabsOrderedByLastAccessed(tabsInGroup);
        if (tabsInGroupOrderedByLastAccessed.length === 0) {
          throw new Error(myLogger.getPrefixedMessage(`tabsInGroupOrderedByLastAccessed is empty`));
        }

        const lastAccessedTab = tabsInGroupOrderedByLastAccessed[tabsInGroupOrderedByLastAccessed.length - 1];
        Logger.attentionLogger.log("lastAccessedTab.title: ", lastAccessedTab, lastAccessedTab.title, lastAccessedTab.lastAccessed);
        if ((tabsInGroup.length === 1 || lastAccessedTab.lastAccessed !== undefined) && lastAccessedTab.title && lastAccessedTab.title !== "") {
          return lastAccessedTab.title;
        }

        return DEFAULT_TITLE;
      })();

      tabGroupUpToDate = await ChromeWindowHelper.getIfTabGroupExists(tabGroup.id);
      if (!tabGroupUpToDate) {
        myLogger.warn(`(2) tabGroupUpToDate not found for tabGroup:${tabGroup.id}`);
        return;
      }

      if (tabGroupUpToDate.title === undefined || tabGroupUpToDate.title === "") {
        tabGroupUpToDate = await ChromeWindowHelper.updateTabGroup(tabGroup.id, { title: newTitle });
        newActiveWindowTabGroup = { ...newActiveWindowTabGroup, title: tabGroupUpToDate.title, useTabTitle: true };
      }
    }

    // 3
    await ActiveWindow.update(activeWindow.windowId, {
      tabGroups: [...activeWindow.tabGroups, newActiveWindowTabGroup],
    });
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

async function onTabGroupUpdated(activeWindow: Types.ActiveWindow, tabGroup: chrome.tabGroups.TabGroup) {
  const myLogger = logger.getNestedLogger("onTabGroupUpdated");
  // 1. handle the case where the tab group's focus mode color is overridden
  //      due to a chromium bug when creating new tab groups
  // 2. if the tab group is focused, update the active window's focus mode focused color
  // 3. if the tab group is NOT focused, update the active window's focus mode nonFocused color
  // 4. focus the tab group
  // 5. activate the last active tab in the group
  // 6. if the tab group's title is updated and it doesnt equal it's active tab's title, then set it's useSetTabTitle to false
  // 7. update the ActiveWindowTabGroup
  try {
    const activeWindowTabGroup = await ActiveWindow.getActiveWindowTabGroup(tabGroup.windowId, tabGroup.id);
    if (activeWindowTabGroup === undefined) {
      myLogger.warn(`activeWindowTabGroup not found for tabGroup:${tabGroup.id}`);
      return;
    }

    const changeInfo = (function generateChangeInfo(activeWindowTabGroup: Types.ActiveWindowTabGroup) {
      const changeInfo: Partial<chrome.tabGroups.TabGroup> = {};
      (Object.keys(tabGroup) as (keyof chrome.tabGroups.TabGroup)[]).forEach((key) => {
        if (key === "id" || key === "windowId") return;
        if (tabGroup[key] !== activeWindowTabGroup[key]) {
          // @ts-ignore
          changeInfo[key] = tabGroup[key];
        }
      });
      return changeInfo;
    })(activeWindowTabGroup);

    myLogger.log(`id: ${tabGroup.id}, title: ${tabGroup.title}, changeInfo:`, changeInfo);

    let tabGroupUpToDate = await ChromeWindowHelper.getIfTabGroupExists(tabGroup.id);
    if (!tabGroupUpToDate) {
      myLogger.warn(`(1) tabGroupUpToDate not found for tabGroup:${tabGroup.id}`);
      return;
    }

    const isTabGroupUpToDate = tabGroupEquals(tabGroup, tabGroupUpToDate);
    if (!isTabGroupUpToDate) {
      // let the most up to date onTabGroupUpdated event handle this operation
      myLogger.warn(`tabGroup is not up to date, ignoring operation`);
      return;
    }

    let newActiveWindowTabGroupsById: { [tabGroupId: string]: Types.ActiveWindowTabGroup } = activeWindow.tabGroups.reduce(
      (acc, tabGroup) => ({ ...acc, [tabGroup.id]: tabGroup }),
      {}
    );

    const wasCollapsed = tabGroup.collapsed && !activeWindowTabGroup.collapsed;
    const wasExpanded = !tabGroup.collapsed && activeWindowTabGroup.collapsed;
    const wasColorUpdated = tabGroup.color !== activeWindowTabGroup.color;
    const wasTitleUpdated = tabGroup.title !== activeWindowTabGroup.title;

    let newFocusModeColors;

    const getUserPreferences = Misc.lazyCall(async () => {
      return (await Storage.getItems("userPreferences")).userPreferences;
    });

    if (activeWindow.focusMode && wasColorUpdated) {
      if (wasTitleUpdated) {
        // 1
        // FIXME: this is a workaround for a chromium bug where updating the title of a newly created tab group
        // causes the color to be reset back to its original (non-focus mode) color. We need to reset back
        // to it's previous color, which is it's respective focus mode color.
        // Remove once the Chromium bug is fixed: https://issues.chromium.org/issues/334965868
        tabGroupUpToDate = await ChromeWindowHelper.updateTabGroup(tabGroup.id, { color: tabGroupUpToDate.color });
        newActiveWindowTabGroupsById[tabGroup.id] = { ...newActiveWindowTabGroupsById[tabGroup.id], color: tabGroupUpToDate.color };
      } else {
        const activeTab = (await chrome.tabs.query({ windowId: tabGroup.windowId, active: true }))[0] as ChromeTabWithId | undefined;
        if (activeTab) {
          const focusedTabGroupId = activeTab.groupId;
          const isFocusedTabGroup = tabGroup.id === focusedTabGroupId;

          tabGroupUpToDate = await ChromeWindowHelper.getIfTabGroupExists(tabGroup.id);
          if (!tabGroupUpToDate) {
            myLogger.warn(`(2) tabGroupUpToDate not found for tabGroup:${tabGroup.id}`);
            return;
          }

          if (isFocusedTabGroup) {
            // 2
            newFocusModeColors = { ...activeWindow.focusMode.colors, focused: tabGroupUpToDate.color };
          } else {
            // 3
            newFocusModeColors = { ...activeWindow.focusMode.colors, nonFocused: tabGroupUpToDate.color };
            // this will effectively update the color of all other non-focused tab groups
            const updatedTabGroups = await ChromeWindowHelper.focusTabGroup(focusedTabGroupId, tabGroup.windowId, {
              collapseUnfocusedTabGroups: false,
              highlightColors: newFocusModeColors,
            });
            updatedTabGroups.forEach((updatedTabGroup) => {
              newActiveWindowTabGroupsById[updatedTabGroup.id] = {
                ...newActiveWindowTabGroupsById[updatedTabGroup.id],
                color: updatedTabGroup.color,
              };
            });
          }

          if (newFocusModeColors) {
            const window = await ChromeWindowHelper.getIfWindowExists(tabGroup.windowId);
            if (window?.focused) {
              await Storage.setItems({ lastSeenFocusModeColors: newFocusModeColors });
            }
          }
        } else {
          myLogger.warn(`could not find activeTab in windowId: ${tabGroup.windowId}`);
        }
      }
    }

    let tabGroupsUpToDate = await chrome.tabGroups.query({ windowId: tabGroup.windowId });
    tabGroupUpToDate = tabGroupsUpToDate.find((otherTabGroup) => otherTabGroup.id === tabGroup.id);
    if (!tabGroupUpToDate) {
      myLogger.warn(`(3) tabGroupUpToDate not found for tabGroup:${tabGroup.id}`);
      return;
    }

    if (wasExpanded && !tabGroupUpToDate.collapsed) {
      // 4
      // FIXME: only focus the tab group if the "activateTabInFocusedTabGroup" user preference is enabled
      tabGroupsUpToDate = await ChromeWindowHelper.focusTabGroup(tabGroup.id, tabGroupsUpToDate, {
        collapseUnfocusedTabGroups: (await getUserPreferences()).collapseUnfocusedTabGroups,
        highlightColors: activeWindow.focusMode?.colors,
      });
      tabGroupsUpToDate.forEach((updatedTabGroup) => {
        newActiveWindowTabGroupsById[updatedTabGroup.id] = {
          ...newActiveWindowTabGroupsById[updatedTabGroup.id],
          collapsed: updatedTabGroup.collapsed,
          color: updatedTabGroup.color,
        };
      });

      // 5
      if ((await getUserPreferences()).activateTabInFocusedTabGroup) {
        const tabsUpToDate = (await chrome.tabs.query({ windowId: tabGroup.windowId })) as ChromeTabWithId[];
        const tabsInGroup = tabsUpToDate.filter((tab) => tab.groupId === tabGroup.id);
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

        tabGroupUpToDate = await ChromeWindowHelper.getIfTabGroupExists(tabGroup.id);
        if (!tabGroupUpToDate) {
          myLogger.warn(`(4) tabGroupUpToDate not found for tabGroup:${tabGroup.id}`);
          return;
        }

        if (!tabGroupUpToDate.collapsed) {
          await ChromeWindowHelper.activateTab(tabToActivate.id);
        }
      }
    }

    const newActiveWindowTabGroups = activeWindow.tabGroups.map((tabGroup) => newActiveWindowTabGroupsById[tabGroup.id]);
    await ActiveWindow.update(activeWindow.windowId, {
      tabGroups: newActiveWindowTabGroups,
      focusMode: activeWindow.focusMode && newFocusModeColors ? { ...activeWindow.focusMode, colors: newFocusModeColors } : activeWindow.focusMode,
    });
  } catch (error) {
    throw new Error(myLogger.getPrefixedMessage(`error:${error}`));
  }
}

// FIXME: this needs to handle the case where the active tab is being dragged
export async function onTabActivated(activeWindow: Types.ActiveWindow, activeInfo: chrome.tabs.TabActiveInfo) {
  const myLogger = logger.getNestedLogger("onTabActivated");
  // 1. focus the tab's group
  // 2. if it's tab group's useSetTabTitle is true, set the tab group's title to the tab's title

  myLogger.log(``, activeInfo.tabId);

  try {
    const tab = await ChromeWindowHelper.getIfTabExists(activeInfo.tabId);
    if (!tab || !tab.id) {
      myLogger.warn(`tab not found for tabId:`, activeInfo.tabId);
      return;
    }

    if (!tab.active) {
      myLogger.warn(`tab no longer active:`, tab.title);
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
  // 1. check if the the tab was updated or removed
  // 2. get the lastActiveTab
  // 3. if the tab is not pinned nor in a group, and the last active tab was in a group, add the tab to the last active tab group
  // 4. if the tab is not pinned nor in a group, and the last active tab was not in a group, and the tab in the
  //      index before the created tab is in a group, create a group for it
  // 5. if the tab is not pinned nor in a group, and the only tab in the window, create a group for it
  myLogger.log(`tab:`, tab.title, tab.groupId);

  if (!tab.id) {
    myLogger.warn(`tabId not found for tab:`, tab);
    return;
  }

  try {
    const tabs = (await chrome.tabs.query({ windowId: tab.windowId })) as ChromeTabWithId[];
    // 1
    const tabIndex = tabs.findIndex((otherTab) => otherTab.id === tab.id);
    if (tabIndex === -1) {
      myLogger.warn(`tab not found for tabId:`, tab.id);
      return;
    }
    tab = tabs[tabIndex];

    // 2
    const tabsOrderedByLastAccessed = await ChromeWindowHelper.getTabsOrderedByLastAccessed(tabs);
    let lastActiveTab: ChromeTabWithId | undefined;
    // the last active tab could be this tab if it is activated, in that case, get the previous last active tab
    if (tabsOrderedByLastAccessed[tabsOrderedByLastAccessed.length - 1]?.id === tab.id) {
      lastActiveTab = tabsOrderedByLastAccessed[tabsOrderedByLastAccessed.length - 2] as ChromeTabWithId | undefined;
    } else {
      lastActiveTab = tabsOrderedByLastAccessed[tabsOrderedByLastAccessed.length - 1] as ChromeTabWithId | undefined;
    }

    const previousIndexTab = tabs.find((otherTab) => otherTab.index === tabIndex - 1);
    const creatingNewTabConsoleMessage = `creating new tab group for tab: '${tab.title}'`;

    if (!tab.pinned && tab.groupId === chrome.tabGroups.TAB_GROUP_ID_NONE) {
      let existingGroupId: ChromeTabGroupId | undefined | null = null;
      if (lastActiveTab) {
        if (lastActiveTab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE) {
          if ((await Storage.getItems("userPreferences")).userPreferences.addNewTabToFocusedTabGroup) {
            // 3
            myLogger.log(`adding created tab '${tab.title}' to last active tab group: '${lastActiveTab.title}'`);
            existingGroupId = lastActiveTab.groupId;
          }
        } else if (previousIndexTab && previousIndexTab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE) {
          // 4
          // TODO: check for `automatically group created tabs` user preference
          myLogger.log(`${creatingNewTabConsoleMessage} (1)`);
          existingGroupId = undefined;
        }
      } else {
        // 5
        // TODO: check for `automatically group created tabs` user preference
        myLogger.log(`${creatingNewTabConsoleMessage} (2)`);
        existingGroupId = undefined;
      }

      if (existingGroupId !== null) {
        const createNewGroup = existingGroupId === undefined;
        tab.groupId = await ChromeWindowHelper.groupTabs({
          createProperties: createNewGroup ? { windowId: tab.windowId } : undefined,
          groupId: createNewGroup ? undefined : existingGroupId,
          tabIds: tab.id,
        });
      }
    }
  } catch (error) {
    throw new Error(myLogger.getPrefixedMessage(`error:${error}`));
  }
}

export async function onTabUpdated(
  activeWindow: Types.ActiveWindow,
  tabId: ChromeTabId,
  changeInfo: chrome.tabs.TabChangeInfo,
  tab: chrome.tabs.Tab,
  getHighlightedTabsPromise: Promise<ChromeTabWithId[]> | undefined
) {
  // 1. check if the tab still exists. This event gets fired even after with groupId set to -1 after the tab is removed.
  // 2. if the tab was ungrouped, create a new group for it
  // 3. if the tab's group changed and the tab is active, focus the tab's group
  const myLogger = logger.getNestedLogger("onTabUpdated");
  myLogger.log(`title, changeInfo and id:`, tab.title, changeInfo, tab.id);

  try {
    // 1
    const tab = await ChromeWindowHelper.getIfTabExists(tabId);
    if (!tab || !tab.id) {
      return;
    }

    if (changeInfo.groupId !== undefined) {
      // 2
      if (
        changeInfo.groupId === chrome.tabGroups.TAB_GROUP_ID_NONE &&
        // check if the tab is still not in a group because of one of two possible reasons:
        //   1. when a user moves a tab to another group, this event gets called with groupId set to -1, then it gets fired again with
        //    groupId set to the group it actually got moved to
        //   2. it could have been auto-grouped by the previous onTabUpdated event if it is one of the highlighted tabs.
        tab.groupId === chrome.tabGroups.TAB_GROUP_ID_NONE &&
        // check if the tab is pinned because this event gets called with groupId set to -1 when the tab gets pinned
        !tab.pinned
      ) {
        // TODO: check for `automatically group created tabs` user preference
        if (getHighlightedTabsPromise === undefined) {
          throw new Error(`getHighlightedTabsPromise is undefined`);
        }
        // get all the highlighted tabs in order to handle the case where multiple tabs are ungrouped together
        const highlightedTabs = await getHighlightedTabsPromise;
        const newGroupId = await ChromeWindowHelper.groupTabs<true>(
          {
            createProperties: { windowId: tab.windowId },
            tabIds: [tab.id, ...highlightedTabs.map((highlightedTab) => highlightedTab.id)],
          },
          async function shouldRetryCallWhileWaitingForUserTabDragging() {
            const tab = await ChromeWindowHelper.getIfTabExists(tabId);
            return tab !== undefined && tab.groupId === chrome.tabGroups.TAB_GROUP_ID_NONE;
          }
        );

        if (newGroupId) {
          tab.groupId = newGroupId;
        }
      }

      // 3
      if (tab.active) {
        await ChromeWindowHelper.focusTabGroup<true>(
          tab.groupId,
          tab.windowId,
          {
            collapseUnfocusedTabGroups: tab.pinned,
            highlightColors: activeWindow.focusMode?.colors,
          },
          async function shouldRetryCallWhileWaitingForUserTabDragging() {
            const tab = await ChromeWindowHelper.getIfTabExists(tabId);
            return tab !== undefined && tab.active && tab.groupId === chrome.tabGroups.TAB_GROUP_ID_NONE;
          }
        );
      }
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

async function onTabReplaced(activeWindow: Types.ActiveWindow, addedTabId: ChromeTabId, removedTabId: ChromeTabId) {
  const myLogger = logger.getNestedLogger("onTabReplaced");
  myLogger.log(`addedTabId and removedTabId:`, addedTabId, removedTabId);
}

function tabGroupEquals(tabGroup: ChromeTabGroupWithId, tabGroupToCompare: ChromeTabGroupWithId) {
  const keys = Object.keys(tabGroupToCompare) as (keyof chrome.tabGroups.TabGroup)[];
  if (keys.length !== Object.keys(tabGroup).length || keys.find((key) => tabGroupToCompare[key] !== tabGroup[key])) {
    return false;
  }

  return true;
}
