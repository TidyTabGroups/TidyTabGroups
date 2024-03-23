import { ActiveWindow } from "../model";
import {
  ChromeTabGroupId,
  ChromeTabGroupWithId,
  ChromeTabId,
  ChromeTabWithId,
  ChromeWindowId,
  LastActiveTabInfo,
  PrimaryTabActivationTimeoutInfo,
} from "../types/types";
import ChromeWindowHelper from "../chromeWindowHelper";
import Misc from "../misc";
import Logger from "../logger";

const awokenTime = new Date();
function justWokeUp() {
  return new Date().getTime() - awokenTime.getTime() < 500;
}

const logger = Logger.getLogger("backgroundEvents", { color: "#fcba03" });

let createdTabGroupingOperationInfo: Promise<{ tabId: ChromeTabId; tabGroupId: ChromeTabGroupId } | null> = Promise.resolve(null);
let tabActivationDueToTabGroupUncollapseOperation: Promise<{ tabId: ChromeTabId; tabGroupId: ChromeTabGroupId } | null> = Promise.resolve(null);
let updateLastActiveTabInfoOperation: Promise<void> = Promise.resolve();

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
  if (!message || !message.type) {
    logger.warn("onMessage::message is not valid:", message);
    return;
  }

  logger.log(`onMessage::message:`, message);

  if (message.type === "pageFocused") {
    // 1. if the tab is pinned, ignore
    // 2. if the tab is awaiting a primary tab activation, set it as the primary tab
    const { tab } = sender;
    if (!tab || !tab.id) {
      logger.warn("onMessage::pageFocused::sender.tab is not valid:", sender);
      return;
    }

    if (tab.pinned) {
      logger.warn("onMessage::pageFocused::tab is pinned:", tab);
      return;
    }

    const activeWindowId = await ActiveWindow.getKey(tab.windowId);
    if (!activeWindowId) {
      logger.warn("onMessage::pageFocused::activeWindow not found:", tab.windowId);
      return;
    }

    const activeWindow = await ActiveWindow.getOrThrow(activeWindowId);
    if (activeWindow.primaryTabActivationInfo) {
      if (activeWindow.primaryTabActivationInfo.tabId === tab.id) {
        await ActiveWindow.triggerPrimaryTabActivation(activeWindowId, tab.id);
      } else {
        logger.warn("onMessage::pageFocused::tab is not the primary tab:", tab, activeWindow.primaryTabActivationInfo);
      }
    }
  }
}

export async function onWindowCreated(window: chrome.windows.Window) {
  if (window.type !== "normal" || !window.id) {
    return;
  }
  logger.log(`onWindowCreated::window:`, window);
  const newActiveWindow = await ActiveWindow.activateWindow(window.id);
  logger.log(`onWindowCreated::newActiveWindow:`, newActiveWindow);
}

export async function onWindowRemoved(windowId: ChromeWindowId) {
  logger.log(`onWindowRemoved::windowId:`, windowId);
  if (!(await ActiveWindow.getKey(windowId))) {
    logger.warn(`onWindowRemoved::activeWindow not found for windowId:`, windowId);
    return;
  }

  await ActiveWindow.deactivateWindow(windowId);
  logger.log(`onWindowRemoved::deactivated window:`, windowId);
}

export async function onTabGroupsUpdated(tabGroup: chrome.tabGroups.TabGroup) {
  // 1. restart the primary tab activation timeout for this window if it exists
  // 2. if the tab group is uncollapsed:
  //   a. collapse all other tab groups
  //   b. if the active tab isnt already in this group, activate the last tab in the group
  logger.log(`onTabGroupsUpdated::tabGroup:`, tabGroup.title, tabGroup.collapsed);
  const tabActivationDueToTabGroupUncollapseOperationPromise = new Misc.NonRejectablePromise<{
    tabId: ChromeTabId;
    tabGroupId: ChromeTabGroupId;
  } | null>();
  let resultingTabActivationDueToTabGroupUncollapseOperation: { tabId: ChromeTabId; tabGroupId: ChromeTabGroupId } | null = null;
  try {
    const previousTabActivationDueToTabGroupUncollapseOperationPromise = tabActivationDueToTabGroupUncollapseOperation;

    tabActivationDueToTabGroupUncollapseOperation = tabActivationDueToTabGroupUncollapseOperationPromise.getPromise();

    const previousTabActivationDueToTabGroupUncollapseOperation = await previousTabActivationDueToTabGroupUncollapseOperationPromise;
    resultingTabActivationDueToTabGroupUncollapseOperation = previousTabActivationDueToTabGroupUncollapseOperation;

    const activeWindowId = await ActiveWindow.getKey(tabGroup.windowId);
    if (!activeWindowId) {
      logger.warn(`onTabGroupsUpdated::activeWindow not found for windowId:`, tabGroup.windowId);
      return;
    }

    // 1
    const activeWindow = await ActiveWindow.getOrThrow(activeWindowId);
    const { primaryTabActivationInfo } = activeWindow;
    if (primaryTabActivationInfo) {
      await ActiveWindow.restartPrimaryTabActivationTimeout(activeWindowId);
    }

    if (!tabGroup.collapsed) {
      // 2.a
      const tabGroups = (await chrome.tabGroups.query({ windowId: tabGroup.windowId, collapsed: false })) as ChromeTabGroupWithId[];
      const otherTabGroups = tabGroups.filter((otherTabGroup) => otherTabGroup.id !== tabGroup.id);
      if (otherTabGroups.length > 0) {
        logger.log(`onTabGroupsUpdated::collapsing all other tab groups`);
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
        resultingTabActivationDueToTabGroupUncollapseOperation = { tabId: lastTabInGroup.id, tabGroupId: tabGroup.id };

        // start loading the tab now (before waiting for the animations to finish)
        if (lastTabInGroup.status === "unloaded") {
          chrome.tabs
            .update(lastTabInGroup.id, { url: lastTabInGroup.url })
            .catch((error) => logger.error(`onTabGroupsUpdated::error discarding tab:${error}`));
        }
        // wait for the tab group uncollapse animations to finish before activatiing the last tab in the group
        const timeToWaitBeforeActivation = justWokeUp() ? 100 : 250;
        await Misc.waitMs(timeToWaitBeforeActivation);
        await ChromeWindowHelper.activateTabAndWait(lastTabInGroup.id);
      }
    }
  } catch (error) {
    logger.error(`onTabGroupsUpdated::error resolving promise with selected tab group:${error}`);
  } finally {
    tabActivationDueToTabGroupUncollapseOperationPromise.resolve(resultingTabActivationDueToTabGroupUncollapseOperation);
  }
}

// FIXME: this needs to handle the case where the active tab is being dragged
export async function onTabActivated(activeInfo: chrome.tabs.TabActiveInfo) {
  // 1. if the window hasnt been activated yet, return
  // 2. if the activated tab isnt awaiting a primary tab activation, clear the primary tab activation
  // 3. start the primary tab activation for the new active tab

  logger.log(`onTabActivated::`, activeInfo.tabId);

  let updateLastActiveTabInfoOperationPromise = new Misc.NonRejectablePromise<void>();
  let updateLastActiveTabInfoInfo: { activeWindowId: ChromeWindowId; lastActiveTabInfo: LastActiveTabInfo } | null = null;

  try {
    updateLastActiveTabInfoOperation = updateLastActiveTabInfoOperationPromise.getPromise();

    const previousCreatedTabGroupingOperationInfo = await createdTabGroupingOperationInfo;

    let tab = (await chrome.tabs.get(activeInfo.tabId)) as ChromeTabWithId;

    logger.log(`onTabActivated::title and groupId:`, tab.title, tab.groupId);

    // 1
    const activeWindowId = await ActiveWindow.getKey(activeInfo.windowId);
    if (!activeWindowId) {
      logger.warn(`onTabActivated::activeWindow not found for windowId:`, activeInfo.windowId);
      return;
    }

    // 2
    const activeWindow = await ActiveWindow.getOrThrow(activeWindowId);
    const { primaryTabActivationInfo } = activeWindow;
    if (primaryTabActivationInfo && primaryTabActivationInfo.tabId !== tab.id) {
      await ActiveWindow.clearPrimaryTabActivation(activeWindowId);
    }

    updateLastActiveTabInfoInfo = { activeWindowId, lastActiveTabInfo: { tabId: tab.id, tabGroupId: tab.groupId, title: tab.title } };

    // 3
    let shouldMakePrimaryNow: boolean;
    logger.log(
      `onTabActivated::previousCreatedTabGroupingOperationInfo:`,
      previousCreatedTabGroupingOperationInfo?.tabId,
      previousCreatedTabGroupingOperationInfo?.tabId === activeInfo.tabId
    );
    if (previousCreatedTabGroupingOperationInfo && previousCreatedTabGroupingOperationInfo.tabId === activeInfo.tabId) {
      updateLastActiveTabInfoInfo.lastActiveTabInfo.tabGroupId = tab.groupId = previousCreatedTabGroupingOperationInfo.tabGroupId;
      createdTabGroupingOperationInfo = Promise.resolve(null);
      shouldMakePrimaryNow = true;
    } else {
      shouldMakePrimaryNow = false;
    }

    // 3
    if (!tab.pinned) {
      if (shouldMakePrimaryNow) {
        await ActiveWindow.setPrimaryTab(tab.windowId, tab.id);
      } else {
        await ActiveWindow.startPrimaryTabActivation(tab.windowId, tab.id);
      }
    }
  } catch (error) {
    logger.error(`onTabActivated::tabGroupIdPromise::error resolving promise with selected tab group:${error}`);
  } finally {
    if (updateLastActiveTabInfoInfo) {
      try {
        const { activeWindowId, lastActiveTabInfo } = updateLastActiveTabInfoInfo;
        await ActiveWindow.update(activeWindowId, { lastActiveTabInfo });
      } catch (error) {
        logger.error(`onTabActivated::error updating lastActiveTabInfo:${error}`);
      }
    }
    updateLastActiveTabInfoOperationPromise.resolve();
  }
}

export async function onTabCreated(tab: chrome.tabs.Tab) {
  // 1. if the tab isnt active and it's position is after the tab awaiting a primary tab activation, cancel the primary tab activation
  // 2. if the tab is not in a group, and the last active tab was in a group, add the tab to the last active tab group
  logger.log(`onTabCreated::tab:`, tab.title);

  if (!tab.id) {
    logger.warn(`onTabCreated::tabId not found for tab:`, tab);
    return;
  }

  const createdTabGroupingOperationInfoPromise = new Misc.NonRejectablePromise<{ tabId: ChromeTabId; tabGroupId: ChromeTabGroupId } | null>();
  let resultingCreatedTabGroupingOperationInfo: { tabId: ChromeTabId; tabGroupId: ChromeTabGroupId } | null = null;

  try {
    const previousLastActiveTabInfoPromise = updateLastActiveTabInfoOperation;
    const previousCreatedTabGroupingOperationInfoPromise = createdTabGroupingOperationInfo;

    createdTabGroupingOperationInfo = createdTabGroupingOperationInfoPromise.getPromise();

    const [_, previousCreatedTabGroupingOperationInfo] = await Promise.all([
      previousLastActiveTabInfoPromise,
      previousCreatedTabGroupingOperationInfoPromise,
    ]);
    resultingCreatedTabGroupingOperationInfo = previousCreatedTabGroupingOperationInfo;

    const activeWindowId = await ActiveWindow.getKey(tab.windowId);
    if (!activeWindowId) {
      logger.warn(`onTabCreated::activeWindow not found for windowId:`, tab.windowId);
      return;
    }

    const activeWindow = await ActiveWindow.getOrThrow(activeWindowId);
    const { lastActiveTabInfo: previousLastActiveTabInfo, primaryTabActivationInfo } = activeWindow;

    // 1
    if (primaryTabActivationInfo && !tab.active) {
      const primaryTabActivationTab = (await chrome.tabs.get(primaryTabActivationInfo.tabId)) as ChromeTabWithId;
      if (tab.index > primaryTabActivationTab.index) {
        logger.log(`onTabCreated::clearing primary tab activation for last active tab:`, primaryTabActivationTab.id, primaryTabActivationTab.title);
        ActiveWindow.clearPrimaryTabActivation(activeWindowId);
      }
    }

    // 2
    if (tab.groupId === chrome.tabGroups.TAB_GROUP_ID_NONE && previousLastActiveTabInfo.tabGroupId !== chrome.tabGroups.TAB_GROUP_ID_NONE) {
      logger.log(`onTabCreated::adding created tab '${tab.title}' to last active tab group: '${previousLastActiveTabInfo.title}'`);
      const tabGroupId = await chrome.tabs.group({ tabIds: tab.id, groupId: previousLastActiveTabInfo.tabGroupId });
      resultingCreatedTabGroupingOperationInfo = { tabId: tab.id, tabGroupId };
    }
  } catch (error) {
    logger.error(`onTabCreated::tabGroupIdPromise::error resolving promise with selected tab group:${error}`);
  } finally {
    createdTabGroupingOperationInfoPromise.resolve(resultingCreatedTabGroupingOperationInfo);
  }
}

export async function onTabUpdated(tabId: ChromeTabId, changeInfo: chrome.tabs.TabChangeInfo, tab: chrome.tabs.Tab) {
  const validChangeInfo: Array<keyof chrome.tabs.TabChangeInfo> = ["groupId"];
  if (!validChangeInfo.find((key) => changeInfo[key] !== undefined)) {
    return;
  }

  // 1. if the groupId property is updated:
  //  a. if the window has a primary tab activation timeout, restart it
  //  b. update the activeWindow's lastActiveTabInfo's groupId property

  logger.log(`onTabUpdated::title, changeInfo and id:`, tab.title, changeInfo, tab.id);

  const updateLastActiveTabInfoOperationPromise = new Misc.NonRejectablePromise<void>();
  let updateLastActiveTabInfoInfo: { activeWindowId: ChromeWindowId; lastActiveTabInfo: LastActiveTabInfo } | null = null;

  try {
    const previousLastActiveTabInfoPromise = updateLastActiveTabInfoOperation;
    updateLastActiveTabInfoOperation = updateLastActiveTabInfoOperationPromise.getPromise();

    await previousLastActiveTabInfoPromise;
    const activeWindow = await ActiveWindow.getByIndex("lastActiveTabId", tabId);
    if (!activeWindow) {
      logger.warn(`onTabsUpdated::activeWindow not found for windowId:`, tab.windowId);
      return;
    }

    const previousLastActiveTabInfo = activeWindow.lastActiveTabInfo;

    // 1
    // we check if the tab still exists because the chrome.tabs.onUpdated event gets called with groupId = -1 when the tab
    //  is removed, in which case we dont care about this event for the current use cases
    if (
      previousLastActiveTabInfo &&
      previousLastActiveTabInfo.tabId === tabId &&
      changeInfo.groupId !== undefined &&
      (await ChromeWindowHelper.doesTabExist(tabId))
    ) {
      // 1.a
      if (activeWindow.primaryTabActivationInfo) {
        await ActiveWindow.restartPrimaryTabActivationTimeout(activeWindow.windowId);
      }

      // 1.b
      updateLastActiveTabInfoInfo = {
        activeWindowId: activeWindow.windowId,
        lastActiveTabInfo: { ...previousLastActiveTabInfo, tabGroupId: changeInfo.groupId },
      };
    }
  } catch (error) {
    logger.error(`onTabUpdated::error resolving promise with selected tab group:${error}`);
  } finally {
    if (updateLastActiveTabInfoInfo) {
      try {
        const { activeWindowId, lastActiveTabInfo } = updateLastActiveTabInfoInfo;
        await ActiveWindow.update(activeWindowId, { lastActiveTabInfo });
      } catch (error) {
        logger.error(`onTabUpdated::error updating lastActiveTabInfo:${error}`);
      }
    }
    updateLastActiveTabInfoOperationPromise.resolve();
  }
}

export async function onTabRemoved(tabId: ChromeTabId, removeInfo: chrome.tabs.TabRemoveInfo) {
  // 1. if the tab was awaiting a primary tab activation, clear the timeout
  logger.log(`onTabRemoved::tabId:`, tabId, removeInfo);
  const activeWindowId = await ActiveWindow.getKey(removeInfo.windowId);
  if (!activeWindowId) {
    logger.warn(`onTabRemoved::activeWindow not found for windowId:`, removeInfo.windowId);
    return;
  }

  const activeWindow = await ActiveWindow.getOrThrow(activeWindowId);
  const { primaryTabActivationInfo } = activeWindow;
  if (primaryTabActivationInfo && primaryTabActivationInfo.tabId === tabId) {
    await ActiveWindow.clearPrimaryTabActivation(activeWindowId);
  }

  if (removeInfo.isWindowClosing) {
    logger.log(`onTabRemoved::window is closing, nothing to do:`, tabId);
    return;
  }
}

export async function onTabMoved(tabId: ChromeTabId, moveInfo: chrome.tabs.TabMoveInfo) {
  // 1. if the window has a primary tab activation timeout, restart it
  logger.log(`onTabMoved::tabId and moveInfo:`, tabId, moveInfo);

  try {
    const activeWindowId = await ActiveWindow.getKey(moveInfo.windowId);
    if (!activeWindowId) {
      logger.warn(`onTabMoved::activeWindow not found for windowId:`, moveInfo.windowId);
      return;
    }

    let tab = (await chrome.tabs.get(tabId)) as ChromeTabWithId;
    logger.log(`onTabMoved::title and groupId:`, tab.title, tab.groupId);

    // 1
    const activeWindow = await ActiveWindow.getOrThrow(activeWindowId);
    const { primaryTabActivationInfo } = activeWindow;
    if (primaryTabActivationInfo) {
      ActiveWindow.restartPrimaryTabActivationTimeout(activeWindowId);
    }
  } catch (error) {
    logger.error(`onTabMoved::error resolving promise with selected tab group:${error}`);
  }
}

export async function onTabReplaced(addedTabId: ChromeTabId, removedTabId: ChromeTabId) {
  // 1. update the activeWindow's primaryTabActivationInfo's tabId property
  // 2. update the activeWindow's lastActiveTabInfo's tabId property
  logger.log(`onTabReplaced::addedTabId and removedTabId:`, addedTabId, removedTabId);

  const updateLastActiveTabInfoOperationPromise = new Misc.NonRejectablePromise<void>();
  let updateActiveWindowInfo: {
    activeWindowId: ChromeWindowId;
    updateProps: { lastActiveTabInfo?: LastActiveTabInfo; primaryTabActivationInfo?: PrimaryTabActivationTimeoutInfo };
  } | null = null;

  try {
    const previousLastActiveTabInfoPromise = updateLastActiveTabInfoOperation;

    updateLastActiveTabInfoOperation = updateLastActiveTabInfoOperationPromise.getPromise();

    await previousLastActiveTabInfoPromise;

    const addedTab = (await chrome.tabs.get(addedTabId)) as ChromeTabWithId;
    const { windowId } = addedTab;

    const activeWindowId = await ActiveWindow.getKey(windowId);
    if (!activeWindowId) {
      logger.warn(`onTabReplaced::activeWindow not found for removedTabId:`, removedTabId);
      return;
    }

    const activeWindow = await ActiveWindow.getOrThrow(activeWindowId);
    const { lastActiveTabInfo: previousLastActiveTabInfo, primaryTabActivationInfo } = activeWindow;

    const updateProps: { lastActiveTabInfo?: LastActiveTabInfo; primaryTabActivationInfo?: PrimaryTabActivationTimeoutInfo } = {};
    // 1
    if (primaryTabActivationInfo && primaryTabActivationInfo.tabId === removedTabId) {
      updateProps.primaryTabActivationInfo = { ...primaryTabActivationInfo, tabId: addedTabId };
    }

    // 2
    updateProps.lastActiveTabInfo = { ...previousLastActiveTabInfo, tabId: addedTabId };

    updateActiveWindowInfo = {
      activeWindowId: activeWindow.windowId,
      updateProps,
    };
  } catch (error) {
    logger.error(`onTabReplaced::error resolving promise with selected tab group:${error}`);
  } finally {
    if (updateActiveWindowInfo) {
      try {
        const { activeWindowId, updateProps } = updateActiveWindowInfo;
        await ActiveWindow.update(activeWindowId, updateProps);
      } catch (error) {
        logger.error(`onTabReplaced::error updating lastActiveTabInfo:${error}`);
      }
    }
    updateLastActiveTabInfoOperationPromise.resolve();
  }
}
