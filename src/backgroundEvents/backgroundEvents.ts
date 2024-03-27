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

let createdTabGroupingOperationInfo: Promise<{ tabId: ChromeTabId; tabGroupId: ChromeTabGroupId } | null> = Promise.resolve(null);
let tabActivationDueToTabGroupUncollapseOperation: Promise<{ tabId: ChromeTabId; tabGroupId: ChromeTabGroupId } | null> = Promise.resolve(null);
let updateLastActiveTabInfoOperation: Promise<void> = Promise.resolve();
let lastGroupedTabInfo: Promise<LastGroupedTabInfo | null> = Promise.resolve(null);

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

    const activeWindow = await ActiveWindow.get(tab.windowId);
    if (!activeWindow) {
      myLogger.warn("pageFocused::activeWindow not found:", tab.windowId);
      return;
    }

    if (activeWindow.primaryTabActivationInfo) {
      if (activeWindow.primaryTabActivationInfo.tabId === tab.id) {
        await ActiveWindow.triggerPrimaryTabActivation(activeWindow.windowId, tab.id);
      } else {
        myLogger.warn("pageFocused::tab is not the primary tab:", tab, activeWindow.primaryTabActivationInfo);
      }
    }
  }
}

export async function onWindowCreated(window: chrome.windows.Window) {
  if (window.type !== "normal" || !window.id) {
    return;
  }
  logger.log(`onWindowCreated::window:`, window);

  // When a populated chrome window from a previous session is created, it can trigger many
  //   succussive tab edit events that we don't want the window activation process to interfere with.
  await ChromeWindowHelper.waitForSuccussiveTabEditEventsToFinish(window.id);
  const newActiveWindow = await ActiveWindow.activateWindow(window.id);
  logger.log(`onWindowCreated::newActiveWindow:`, newActiveWindow);
}

export async function onWindowRemoved(windowId: ChromeWindowId) {
  logger.log(`onWindowRemoved::windowId:`, windowId);
  if (!(await ActiveWindow.get(windowId))) {
    logger.warn(`onWindowRemoved::activeWindow not found for windowId:`, windowId);
    return;
  }

  await ActiveWindow.deactivateWindow(windowId);
  logger.log(`onWindowRemoved::deactivated window:`, windowId);
}

export async function onTabGroupsUpdated(tabGroup: chrome.tabGroups.TabGroup) {
  const myLogger = logger.getNestedLogger("onTabGroupsUpdated");
  // 1. adjust the window's primary tab activation for this event
  // 2. if the tab group is uncollapsed:
  //   a. collapse all other tab groups
  //   b. if the active tab isnt already in this group, activate the last tab in the group
  myLogger.log(`tabGroup:`, tabGroup.id, tabGroup.title, tabGroup.collapsed);
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

    const activeWindow = await ActiveWindow.get(tabGroup.windowId);
    if (!activeWindow) {
      myLogger.warn(`activeWindow not found for windowId:`, tabGroup.windowId);
      return;
    }

    // 1
    await ActiveWindow.clearOrRestartOrStartNewPrimaryTabActivationForTabEvent(activeWindow.windowId, -1, false, false, false);

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
        resultingTabActivationDueToTabGroupUncollapseOperation = { tabId: lastTabInGroup.id, tabGroupId: tabGroup.id };

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
    myLogger.error(`error resolving promise with selected tab group:${error}`);
  } finally {
    tabActivationDueToTabGroupUncollapseOperationPromise.resolve(resultingTabActivationDueToTabGroupUncollapseOperation);
  }
}

// FIXME: this needs to handle the case where the active tab is being dragged
export async function onTabActivated(activeInfo: chrome.tabs.TabActiveInfo) {
  const myLogger = logger.getNestedLogger("onTabActivated");
  // 1. adjust the window's primary tab activation for this event
  // 2. update the activeWindow's lastActiveTabInfo

  myLogger.log(``, activeInfo.tabId);

  let updateLastActiveTabInfoOperationPromise = new Misc.NonRejectablePromise<void>();
  let updateLastActiveTabInfoInfo: { activeWindowId: ChromeWindowId; lastActiveTabInfo: LastActiveTabInfo } | null = null;

  try {
    updateLastActiveTabInfoOperation = updateLastActiveTabInfoOperationPromise.getPromise();

    const previousCreatedTabGroupingOperationInfo = await createdTabGroupingOperationInfo;

    const activeWindow = await ActiveWindow.get(activeInfo.windowId);
    if (!activeWindow) {
      myLogger.warn(`activeWindow not found for windowId:`, activeInfo.windowId);
      return;
    }

    const tab = (await chrome.tabs.get(activeInfo.tabId)) as ChromeTabWithId;

    myLogger.log(`title and groupId:`, tab.title, tab.groupId);

    myLogger.log(
      `previousCreatedTabGroupingOperationInfo:`,
      previousCreatedTabGroupingOperationInfo?.tabId,
      previousCreatedTabGroupingOperationInfo?.tabId === activeInfo.tabId
    );
    if (previousCreatedTabGroupingOperationInfo && previousCreatedTabGroupingOperationInfo.tabId === activeInfo.tabId) {
      tab.groupId = previousCreatedTabGroupingOperationInfo.tabGroupId;
      createdTabGroupingOperationInfo = Promise.resolve(null);
    }

    // 1
    await ActiveWindow.clearOrRestartOrStartNewPrimaryTabActivationForTabEvent(activeWindow.windowId, tab.id, tab.active, tab.pinned, false);

    // 2
    updateLastActiveTabInfoInfo = {
      activeWindowId: activeWindow.windowId,
      lastActiveTabInfo: { tabId: tab.id, tabGroupId: tab.groupId, title: tab.title },
    };
  } catch (error) {
    myLogger.error(`tabGroupIdPromise::error resolving promise with selected tab group:${error}`);
  } finally {
    if (updateLastActiveTabInfoInfo) {
      try {
        const { activeWindowId, lastActiveTabInfo } = updateLastActiveTabInfoInfo;
        await ActiveWindow.update(activeWindowId, { lastActiveTabInfo });
      } catch (error) {
        myLogger.error(`error updating lastActiveTabInfo:${error}`);
      }
    }
    updateLastActiveTabInfoOperationPromise.resolve();
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

    const activeWindow = await ActiveWindow.get(tab.windowId);
    if (!activeWindow) {
      myLogger.warn(`activeWindow not found for windowId:`, tab.windowId);
      return;
    }

    const { lastActiveTabInfo: previousLastActiveTabInfo, primaryTabActivationInfo } = activeWindow;

    // 1
    if (primaryTabActivationInfo && !tab.active) {
      const primaryTabActivationTab = (await chrome.tabs.get(primaryTabActivationInfo.tabId)) as ChromeTabWithId;
      if (tab.index > primaryTabActivationTab.index) {
        myLogger.log(`clearing primary tab activation for last active tab:`, primaryTabActivationTab.id, primaryTabActivationTab.title);
        await ActiveWindow.clearPrimaryTabActivation(activeWindow.windowId);
      }
    }

    // 2
    // By now, the the tab's group could have been updated. If so, lastGroupedTabInfo will contain that info. Note, for
    //   this to work, it relies on the fact that this is code path is async, otherwise, lastGroupedTabInfo wont be updated in time in the tabs.onUpdated handler
    const previousLastGroupedTabInfo = await lastGroupedTabInfo;
    const updatedTabGroupId =
      previousLastGroupedTabInfo?.tabId === tab.id && previousLastGroupedTabInfo.tabGroupId !== undefined
        ? previousLastGroupedTabInfo.tabGroupId
        : null;
    if (updatedTabGroupId !== null) {
      myLogger.log(`updatedTabGroupId:`, updatedTabGroupId);
      tab.groupId = updatedTabGroupId;
    }

    if (
      !tab.pinned &&
      tab.groupId === chrome.tabGroups.TAB_GROUP_ID_NONE &&
      previousLastActiveTabInfo.tabGroupId !== chrome.tabGroups.TAB_GROUP_ID_NONE
    ) {
      myLogger.log(`adding created tab '${tab.title}' to last active tab group: '${previousLastActiveTabInfo.title}'`);
      const tabGroupId = await chrome.tabs.group({ tabIds: tab.id, groupId: previousLastActiveTabInfo.tabGroupId });
      resultingCreatedTabGroupingOperationInfo = { tabId: tab.id, tabGroupId };
    }
  } catch (error) {
    myLogger.error(`tabGroupIdPromise::error resolving promise with selected tab group:${error}`);
  } finally {
    createdTabGroupingOperationInfoPromise.resolve(resultingCreatedTabGroupingOperationInfo);
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

  const lastGroupedTabInfoPromise = new Misc.NonRejectablePromise<LastGroupedTabInfo | null>();
  let resultingLastGroupedTabInfo: LastGroupedTabInfo | null = null;

  const updateLastActiveTabInfoOperationPromise = new Misc.NonRejectablePromise<void>();
  let updateLastActiveTabInfoInfo: { activeWindowId: ChromeWindowId; lastActiveTabInfo: LastActiveTabInfo } | null = null;

  try {
    const previousLastActiveTabInfoPromise = updateLastActiveTabInfoOperation;
    updateLastActiveTabInfoOperation = updateLastActiveTabInfoOperationPromise.getPromise();

    const previousLastGroupedTabInfoPromise = lastGroupedTabInfo;
    lastGroupedTabInfo = lastGroupedTabInfoPromise.getPromise();

    resultingLastGroupedTabInfo = await previousLastGroupedTabInfoPromise;

    await previousLastActiveTabInfoPromise;

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
      resultingLastGroupedTabInfo = { tabId, tabGroupId: changeInfo.groupId };

      // 1.a
      await ActiveWindow.clearOrRestartOrStartNewPrimaryTabActivationForTabEvent(activeWindow.windowId, tab.id, tab.active, tab.pinned, false);

      if (previousLastActiveTabInfo && previousLastActiveTabInfo.tabId === tabId) {
        // 1.b
        updateLastActiveTabInfoInfo = {
          activeWindowId: activeWindow.windowId,
          lastActiveTabInfo: { ...previousLastActiveTabInfo, tabGroupId: changeInfo.groupId },
        };
      }
    }
  } catch (error) {
    myLogger.error(`error resolving promise with selected tab group:${error}`);
  } finally {
    if (updateLastActiveTabInfoInfo) {
      try {
        const { activeWindowId, lastActiveTabInfo } = updateLastActiveTabInfoInfo;
        await ActiveWindow.update(activeWindowId, { lastActiveTabInfo });
      } catch (error) {
        myLogger.error(`error updating lastActiveTabInfo:${error}`);
      }
    }
    updateLastActiveTabInfoOperationPromise.resolve();
    lastGroupedTabInfoPromise.resolve(resultingLastGroupedTabInfo);
  }
}

export async function onTabRemoved(tabId: ChromeTabId, removeInfo: chrome.tabs.TabRemoveInfo) {
  const myLogger = logger.getNestedLogger("onTabRemoved");
  // 1. adjust the window's primary tab activation for this event
  myLogger.log(`tabId:`, tabId, removeInfo);
  try {
    const activeWindow = await ActiveWindow.get(removeInfo.windowId);
    if (!activeWindow) {
      myLogger.warn(`activeWindow not found for windowId:`, removeInfo.windowId);
      return;
    }

    await ActiveWindow.clearOrRestartOrStartNewPrimaryTabActivationForTabEvent(activeWindow.windowId, -1, false, false, true);

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
    const activeWindow = await ActiveWindow.get(moveInfo.windowId);
    if (!activeWindow) {
      myLogger.warn(`activeWindow not found for windowId:`, moveInfo.windowId);
      return;
    }

    const tab = (await chrome.tabs.get(tabId)) as ChromeTabWithId;

    myLogger.log(`title and groupId:`, tab.title, tab.groupId);

    // 1
    await ActiveWindow.clearOrRestartOrStartNewPrimaryTabActivationForTabEvent(activeWindow.windowId, tab.id, tab.active, tab.pinned, false);
  } catch (error) {
    myLogger.error(`error resolving promise with selected tab group:${error}`);
  }
}

export async function onTabReplaced(addedTabId: ChromeTabId, removedTabId: ChromeTabId) {
  const myLogger = logger.getNestedLogger("onTabReplaced");
  // 1. update the activeWindow's primaryTabActivationInfo's tabId property
  // 2. update the activeWindow's lastActiveTabInfo's tabId property
  myLogger.log(`addedTabId and removedTabId:`, addedTabId, removedTabId);

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

    const activeWindow = await ActiveWindow.get(windowId);
    if (!activeWindow) {
      myLogger.warn(`activeWindow not found for removedTabId:`, removedTabId);
      return;
    }

    const { lastActiveTabInfo: previousLastActiveTabInfo, primaryTabActivationInfo } = activeWindow;

    const updateProps: { lastActiveTabInfo?: LastActiveTabInfo; primaryTabActivationInfo?: PrimaryTabActivationTimeoutInfo } = {};
    // 1
    if (primaryTabActivationInfo && primaryTabActivationInfo.tabId === removedTabId) {
      updateProps.primaryTabActivationInfo = { ...primaryTabActivationInfo, tabId: addedTabId };
    }

    // 2
    if (previousLastActiveTabInfo && previousLastActiveTabInfo.tabId === removedTabId) {
      updateProps.lastActiveTabInfo = { ...previousLastActiveTabInfo, tabId: addedTabId };
    }

    updateActiveWindowInfo = {
      activeWindowId: activeWindow.windowId,
      updateProps,
    };
  } catch (error) {
    myLogger.error(`error resolving promise with selected tab group:${error}`);
  } finally {
    if (updateActiveWindowInfo) {
      try {
        const { activeWindowId, updateProps } = updateActiveWindowInfo;
        await ActiveWindow.update(activeWindowId, updateProps);
      } catch (error) {
        myLogger.error(`error updating lastActiveTabInfo:${error}`);
      }
    }
    updateLastActiveTabInfoOperationPromise.resolve();
  }
}
