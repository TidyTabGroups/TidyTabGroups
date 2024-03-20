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
import { update } from "../model/ActiveTabGroup";

let createdTabGroupingOperationInfo: Promise<{ tabId: ChromeTabId; tabGroupId: ChromeTabGroupId } | null> = Promise.resolve(null);
let tabActivationDueToTabGroupUncollapseOperation: Promise<{ tabId: ChromeTabId; tabGroupId: ChromeTabGroupId } | null> = Promise.resolve(null);
let updateLastActiveTabInfoOperation: Promise<void> = Promise.resolve();

export async function onInstalled(details: chrome.runtime.InstalledDetails) {
  console.log(`onInstalled::Extension was installed because of: ${details.reason}`);
  if (details.reason === "install") {
    // TODO: open the onboarding page
  }

  const newActiveWindows = await ActiveWindow.reactivateAllWindows();
  console.log(`onInstalled::reactivated all windows:`, newActiveWindows);

  // inject the content script into all tabs
  const tabs = (await chrome.tabs.query({})) as ChromeTabWithId[];
  for (const tab of tabs) {
    chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, files: ["js/content_script.js"] });
  }

  // Misc.openDummyTab();
}

export async function onMessage(message: any, sender: chrome.runtime.MessageSender, sendResponse: (response?: any) => void) {
  if (!message || !message.type) {
    console.warn("onMessage::message is not valid:", message);
    return;
  }

  console.log(`onMessage::message:`, message);

  if (message.type === "primaryTabActivationTrigger") {
    const { tab } = sender;
    if (!tab || !tab.id || tab.pinned) {
      console.warn("onMessage::primaryTabActivationTrigger::sender.tab is not valid:", sender);
      return;
    }

    await ActiveWindow.setPrimaryTab(tab.windowId, tab.id);
  }
}

export async function onWindowCreated(window: chrome.windows.Window) {
  if (window.type !== "normal" || !window.id) {
    return;
  }
  console.log(`onWindowCreated::window:`, window);
  const newActiveWindow = await ActiveWindow.activateWindow(window.id);
  console.log(`onWindowCreated::newActiveWindow:`, newActiveWindow);
}

export async function onWindowRemoved(windowId: ChromeWindowId) {
  console.log(`onWindowRemoved::windowId:`, windowId);
  await ActiveWindow.remove(windowId);
  console.log(`onWindowRemoved::removedActiveWindow:`, windowId);
}

export async function onTabGroupsUpdated(tabGroup: chrome.tabGroups.TabGroup) {
  console.log(`onTabGroupsUpdated::tabGroup:`, tabGroup.title, tabGroup.collapsed);
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
      console.warn(`onTabGroupsUpdated::activeWindow not found for windowId:`, tabGroup.windowId);
      return;
    }

    const tabs = (await chrome.tabs.query({ windowId: tabGroup.windowId })) as ChromeTabWithId[];
    if (!tabGroup.collapsed) {
      // if the active tab isnt already in this group, activate the last tab in the group
      const tabsInGroup = tabs.filter((tab) => tab.groupId === tabGroup.id);
      const activeTabInGroup = tabsInGroup.find((tab) => tab.active);
      if (!activeTabInGroup) {
        const lastTabInGroup = tabsInGroup[tabsInGroup.length - 1];
        resultingTabActivationDueToTabGroupUncollapseOperation = { tabId: lastTabInGroup.id, tabGroupId: tabGroup.id };
        await ChromeWindowHelper.activateTabAndWait(lastTabInGroup.id);
      }
    }
  } catch (error) {
    console.error(`onTabGroupsUpdated::error resolving promise with selected tab group:${error}`);
  } finally {
    tabActivationDueToTabGroupUncollapseOperationPromise.resolve(resultingTabActivationDueToTabGroupUncollapseOperation);
  }
}

export async function onTabActivated(activeInfo: chrome.tabs.TabActiveInfo) {
  // 1. if the window hasnt been activated yet, return
  // 2. if the activated tab isnt the tab waiting for a primary tab activation, clear the primary tab activation
  // 3. collapse all other tab groups in the window, and enable the primary tab trigger for the new active tab

  console.log(`onTabActivated::`, activeInfo.tabId);

  let updateLastActiveTabInfoOperationPromise = new Misc.NonRejectablePromise<void>();
  let updateLastActiveTabInfoInfo: { activeWindowId: ChromeWindowId; lastActiveTabInfo: LastActiveTabInfo } | null = null;

  try {
    updateLastActiveTabInfoOperation = updateLastActiveTabInfoOperationPromise.getPromise();

    const previousCreatedTabGroupingOperationInfo = await createdTabGroupingOperationInfo;

    let tab = (await chrome.tabs.get(activeInfo.tabId)) as ChromeTabWithId;

    console.log(`onTabActivated::title and groupId:`, tab.title, tab.groupId);

    // 1
    const activeWindowId = await ActiveWindow.getKey(activeInfo.windowId);
    if (!activeWindowId) {
      console.warn(`onTabActivated::activeWindow not found for windowId:`, activeInfo.windowId);
      return;
    }

    const activeWindow = await ActiveWindow.get(activeWindowId);
    const { primaryTabActivationTimeoutInfo } = activeWindow;
    if (primaryTabActivationTimeoutInfo && primaryTabActivationTimeoutInfo.tabId !== tab.id) {
      ActiveWindow.clearPrimaryTabActivation(activeWindowId, primaryTabActivationTimeoutInfo.timeoutId);
    }

    updateLastActiveTabInfoInfo = { activeWindowId, lastActiveTabInfo: { tabId: tab.id, tabGroupId: tab.groupId, title: tab.title } };

    // 3
    let shouldMakePrimaryNow: boolean;
    console.log(
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

    const tabGroups = (await chrome.tabGroups.query({ windowId: tab.windowId, collapsed: false })) as ChromeTabGroupWithId[];
    const otherNonCollapsedTabGroups =
      tab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE ? tabGroups.filter((tabGroup) => tabGroup.id !== tab.groupId) : tabGroups;
    console.log(`onTabActivated::collapsing all non-collapsed tab groups except:`, tab.groupId);
    await Promise.all(
      otherNonCollapsedTabGroups.map(async (tabGroup) => {
        await ChromeWindowHelper.updateTabGroupAndWait(tabGroup.id, { collapsed: true });
      })
    );

    if (!tab.pinned) {
      if (shouldMakePrimaryNow) {
        await ActiveWindow.setPrimaryTab(tab.windowId, tab.id);
      } else {
        await ActiveWindow.startPrimaryTabActivationIfNotScriptable(tab.id);
      }
    }
  } catch (error) {
    console.error(`onTabActivated::tabGroupIdPromise::error resolving promise with selected tab group:${error}`);
  } finally {
    if (updateLastActiveTabInfoInfo) {
      try {
        const { activeWindowId, lastActiveTabInfo } = updateLastActiveTabInfoInfo;
        await ActiveWindow.update(activeWindowId, { lastActiveTabInfo });
      } catch (error) {
        console.error(`onTabActivated::error updating lastActiveTabInfo:${error}`);
      }
    }
    updateLastActiveTabInfoOperationPromise.resolve();
  }
}

export async function onTabCreated(tab: chrome.tabs.Tab) {
  // 1. if the window has a primary tab activation timeout, restart it
  // 2. if the tab is not in a group, and the last active tab was in a group, add the tab to the last active tab group
  console.log(`onTabCreated::tab:`, tab.title);

  if (!tab.id) {
    console.warn(`onTabCreated::tabId not found for tab:`, tab);
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
      console.warn(`onTabCreated::activeWindow not found for windowId:`, tab.windowId);
      return;
    }

    const activeWindow = await ActiveWindow.get(activeWindowId);
    const { lastActiveTabInfo: previousLastActiveTabInfo, primaryTabActivationTimeoutInfo } = activeWindow;

    // 1
    if (primaryTabActivationTimeoutInfo) {
      ActiveWindow.restartPrimaryTabActivation(activeWindowId);
    }

    // 2
    if (tab.groupId === chrome.tabGroups.TAB_GROUP_ID_NONE && previousLastActiveTabInfo.tabGroupId !== chrome.tabGroups.TAB_GROUP_ID_NONE) {
      console.log(`onTabCreated::adding created tab '${tab.title}' to last active tab group: '${previousLastActiveTabInfo.title}'`);
      const tabGroupId = await chrome.tabs.group({ tabIds: tab.id, groupId: previousLastActiveTabInfo.tabGroupId });
      resultingCreatedTabGroupingOperationInfo = { tabId: tab.id, tabGroupId };
    }
  } catch (error) {
    console.error(`onTabCreated::tabGroupIdPromise::error resolving promise with selected tab group:${error}`);
  } finally {
    createdTabGroupingOperationInfoPromise.resolve(resultingCreatedTabGroupingOperationInfo);
  }
}

export async function onTabUpdated(tabId: ChromeTabId, changeInfo: chrome.tabs.TabChangeInfo, tab: chrome.tabs.Tab) {
  const validChangeInfo: Array<keyof chrome.tabs.TabChangeInfo> = ["groupId"];
  if (!validChangeInfo.find((key) => changeInfo[key] !== undefined)) {
    return;
  }

  // 1. update the activeWindow's lastActiveTabInfo's groupId property

  console.log(`onTabUpdated::title, changeInfo and id:`, tab.title, changeInfo, tab.id);

  const updateLastActiveTabInfoOperationPromise = new Misc.NonRejectablePromise<void>();
  let updateLastActiveTabInfoInfo: { activeWindowId: ChromeWindowId; lastActiveTabInfo: LastActiveTabInfo } | null = null;

  try {
    const previousLastActiveTabInfoPromise = updateLastActiveTabInfoOperation;
    updateLastActiveTabInfoOperation = updateLastActiveTabInfoOperationPromise.getPromise();

    await previousLastActiveTabInfoPromise;
    const activeWindow = await ActiveWindow.getByIndex("lastActiveTabId", tabId);
    if (!activeWindow) {
      console.warn(`onTabsUpdated::activeWindow not found for windowId:`, tab.windowId);
      return;
    }

    const previousLastActiveTabInfo = activeWindow.lastActiveTabInfo;

    // 1
    // we check if the tab still exists because the chrome.tabs.onUpdated event gets called with groupId = -1 when the tab is removed, and we
    //  dont want to forget which tab group the removed tab belonged to in lastActiveTabInfo
    if (
      previousLastActiveTabInfo &&
      previousLastActiveTabInfo.tabId === tabId &&
      changeInfo.groupId !== undefined &&
      (await ChromeWindowHelper.doesTabExist(tabId))
    ) {
      updateLastActiveTabInfoInfo = {
        activeWindowId: activeWindow.windowId,
        lastActiveTabInfo: { ...previousLastActiveTabInfo, tabGroupId: changeInfo.groupId },
      };
    }
  } catch (error) {
    console.error(`onTabUpdated::error resolving promise with selected tab group:${error}`);
  } finally {
    if (updateLastActiveTabInfoInfo) {
      try {
        const { activeWindowId, lastActiveTabInfo } = updateLastActiveTabInfoInfo;
        await ActiveWindow.update(activeWindowId, { lastActiveTabInfo });
      } catch (error) {
        console.error(`onTabUpdated::error updating lastActiveTabInfo:${error}`);
      }
    }
    updateLastActiveTabInfoOperationPromise.resolve();
  }
}

export async function onTabRemoved(tabId: ChromeTabId, removeInfo: chrome.tabs.TabRemoveInfo) {
  // 1. if the tab was awaiting a primary tab activation, clear the timeout
  console.log(`onTabRemoved::tabId:`, tabId, removeInfo);
  const activeWindowId = await ActiveWindow.getKey(removeInfo.windowId);
  if (!activeWindowId) {
    console.warn(`onTabRemoved::activeWindow not found for windowId:`, removeInfo.windowId);
    return;
  }

  const activeWindow = await ActiveWindow.get(activeWindowId);
  const { primaryTabActivationTimeoutInfo } = activeWindow;
  if (primaryTabActivationTimeoutInfo && primaryTabActivationTimeoutInfo.tabId === tabId) {
    await ActiveWindow.clearPrimaryTabActivation(activeWindowId, primaryTabActivationTimeoutInfo.timeoutId);
  }

  if (removeInfo.isWindowClosing) {
    console.log(`onTabRemoved::window is closing, nothing to do:`, tabId);
    return;
  }
}

export async function onTabMoved(tabId: ChromeTabId, moveInfo: chrome.tabs.TabMoveInfo) {
  // 1. if the window has a primary tab activation timeout, restart it
  console.log(`onTabMoved::tabId and moveInfo:`, tabId, moveInfo);

  try {
    const activeWindowId = await ActiveWindow.getKey(moveInfo.windowId);
    if (!activeWindowId) {
      console.warn(`onTabMoved::activeWindow not found for windowId:`, moveInfo.windowId);
      return;
    }

    let tab = (await chrome.tabs.get(tabId)) as ChromeTabWithId;
    console.log(`onTabMoved::title and groupId:`, tab.title, tab.groupId);

    // 1
    const activeWindow = await ActiveWindow.get(activeWindowId);
    const { primaryTabActivationTimeoutInfo } = activeWindow;
    if (primaryTabActivationTimeoutInfo) {
      ActiveWindow.restartPrimaryTabActivation(activeWindowId);
    }
  } catch (error) {
    console.error(`onTabMoved::error resolving promise with selected tab group:${error}`);
  }
}

export async function onTabReplaced(addedTabId: ChromeTabId, removedTabId: ChromeTabId) {
  // 1. update the activeWindow's primaryTabActivationTimeoutInfo's tabId property
  // 2. update the activeWindow's lastActiveTabInfo's tabId property
  console.log(`onTabReplaced::addedTabId and removedTabId:`, addedTabId, removedTabId);

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
      console.warn(`onTabReplaced::activeWindow not found for removedTabId:`, removedTabId);
      return;
    }

    const activeWindow = await ActiveWindow.get(activeWindowId);
    const { lastActiveTabInfo: previousLastActiveTabInfo, primaryTabActivationTimeoutInfo } = activeWindow;

    const updateProps: { lastActiveTabInfo?: LastActiveTabInfo; primaryTabActivationInfo?: PrimaryTabActivationTimeoutInfo } = {};
    // 1
    if (primaryTabActivationTimeoutInfo && primaryTabActivationTimeoutInfo.tabId === removedTabId) {
      updateProps.primaryTabActivationInfo = { ...primaryTabActivationTimeoutInfo, tabId: addedTabId };
    }

    // 2
    updateProps.lastActiveTabInfo = { ...previousLastActiveTabInfo, tabId: addedTabId };

    updateActiveWindowInfo = {
      activeWindowId: activeWindow.windowId,
      updateProps,
    };
  } catch (error) {
    console.error(`onTabReplaced::error resolving promise with selected tab group:${error}`);
  } finally {
    if (updateActiveWindowInfo) {
      try {
        const { activeWindowId, updateProps } = updateActiveWindowInfo;
        await ActiveWindow.update(activeWindowId, updateProps);
      } catch (error) {
        console.error(`onTabReplaced::error updating lastActiveTabInfo:${error}`);
      }
    }
    updateLastActiveTabInfoOperationPromise.resolve();
  }
}
