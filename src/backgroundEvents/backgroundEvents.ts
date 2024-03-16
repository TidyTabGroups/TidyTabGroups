import { ActiveWindow } from "../model";
import {
  ChromeTabGroupId,
  ChromeTabGroupWithId,
  ChromeTabId,
  ChromeTabWithId,
  ChromeWindowId,
  ChromeWindowWithId,
  LastActiveTabInfo,
} from "../types/types";
import ChromeWindowHelper from "../chromeWindowHelper";

let createdTabGroupingOperationInfo: Promise<{ tabId: ChromeTabId; tabGroupId: ChromeTabGroupId } | null> = Promise.resolve(null);
let tabActivationDueToTabGroupUncollapseOperation: Promise<{ tabId: ChromeTabId; tabGroupId: ChromeTabGroupId } | null> = Promise.resolve(null);
let manualTabActivationOperationInfo: ChromeTabId | null = null;
let lastUndiscardedTabInfo: ChromeTabId | null = null;
let settingLastActiveTabInfo = true;
let lastActiveTabInfo: Promise<LastActiveTabInfo | null> = new Promise(async (resolve, reject) => {
  try {
    const [activeTab] = (await chrome.tabs.query({ active: true, lastFocusedWindow: true })) as ChromeTabWithId[];
    settingLastActiveTabInfo = false;
    resolve(activeTab ? { tabId: activeTab.id, tabGroupId: activeTab.groupId, title: activeTab.title } : null);
  } catch (error) {
    reject(`lastActiveTabInfo::error getting last active tab info:${error}`);
  }
});

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
    chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["js/content_script.js"] });
  }

  // Misc.openDummyTab();
}

export async function onMessage(message: any, sender: chrome.runtime.MessageSender, sendResponse: (response?: any) => void) {
  if (!message || !message.type || !message.data) {
    console.warn("onMessage::message is not valid:", message);
    return;
  }

  console.log(`onMessage::message:`, message);

  if (message.type === "primaryTabTrigger") {
    const { tab } = sender;
    if (!tab || !tab.id || tab.pinned) {
      console.warn("onMessage::primaryTabTrigger::sender.tab is not valid:", sender);
      return;
    }
    const { triggerType } = message.data;
    console.log(`onMessage::primaryTabTrigger::triggerType:`, triggerType);

    ActiveWindow.setPrimaryTab(tab.windowId, tab.id);
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
  const previousTabActivationDueToTabGroupUncollapseOperationPromise = tabActivationDueToTabGroupUncollapseOperation;
  tabActivationDueToTabGroupUncollapseOperation = new Promise(async (resolve) => {
    let resultingTabActivationDueToTabGroupUncollapseOperation: { tabId: ChromeTabId; tabGroupId: ChromeTabGroupId } | null = null;
    try {
      const previousTabActivationDueToTabGroupUncollapseOperation = await previousTabActivationDueToTabGroupUncollapseOperationPromise;
      resultingTabActivationDueToTabGroupUncollapseOperation = previousTabActivationDueToTabGroupUncollapseOperation;
      const activeWindowId = await ActiveWindow.getKey(tabGroup.windowId);
      if (!activeWindowId) {
        console.warn(`onTabGroupsUpdated::activeWindow not found for windowId:`, tabGroup.windowId);
        resolve(resultingTabActivationDueToTabGroupUncollapseOperation);
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
      resolve(resultingTabActivationDueToTabGroupUncollapseOperation);
    }
  });
}

export async function onTabActivated(activeInfo: chrome.tabs.TabActiveInfo) {
  console.log(`onTabActivated::`, activeInfo.tabId);

  // 1. if the window hasnt been activated yet, return
  // 2. reset manualTabActivationOperationInfo
  // 3. if the last active tab was closed, or the last active tab group was collapsed, do a manual tab activation, then return
  // 4. set the opener tab id of the tab to the tab to activate if closed
  // 5. collapse all other tab groups in the window, and enable the primary tab trigger for the new active tab

  lastActiveTabInfo = new Promise(async (resolve) => {
    let resultingLastActiveTabInfo: LastActiveTabInfo | null = null;
    const previousLastActiveTabInfoPromise = lastActiveTabInfo;
    const previousCreatedTabGroupingOperationInfoPromise = createdTabGroupingOperationInfo;
    try {
      const [previousLastActiveTabInfo, previousCreatedTabGroupingOperationInfo] = await Promise.all([
        settingLastActiveTabInfo ? null : previousLastActiveTabInfoPromise,
        previousCreatedTabGroupingOperationInfoPromise,
      ]);
      resultingLastActiveTabInfo = previousLastActiveTabInfo;

      let tab = (await chrome.tabs.get(activeInfo.tabId)) as ChromeTabWithId;

      console.log(`onTabActivated::title and groupId:`, tab.title, tab.groupId);
      console.log(`onTabActivated::lastActiveTabInfo:`, previousLastActiveTabInfo?.title || "N/A", previousLastActiveTabInfo?.tabId || "N/A");

      // 2
      const activeWindowId = await ActiveWindow.getKey(activeInfo.windowId);
      if (!activeWindowId) {
        console.warn(`onTabActivated::activeWindow not found for windowId:`, activeInfo.windowId);
        return;
      }

      // 3
      manualTabActivationOperationInfo = null;

      const tabs = (await chrome.tabs.query({ windowId: tab.windowId })) as ChromeTabWithId[];

      // 4
      if (previousLastActiveTabInfo) {
        const previousLastActiveTabWasClosed = !(await ChromeWindowHelper.doesTabExist(previousLastActiveTabInfo.tabId));

        const previousLastActiveTabGroup =
          previousLastActiveTabInfo.tabGroupId !== chrome.tabGroups.TAB_GROUP_ID_NONE
            ? (await ChromeWindowHelper.getIfTabGroupExists(previousLastActiveTabInfo.tabGroupId)) || null
            : null;
        const previousLastActiveTabGroupWasCollapsed = previousLastActiveTabGroup?.collapsed || false;

        let tabToManuallyActivateId: ChromeTabId | null = null;
        if (previousLastActiveTabWasClosed) {
          const tabToActivateIfClosedId = await ActiveWindow.getTabToActivateIfTabClosed(tabs, previousLastActiveTabInfo);
          if (tab.id !== tabToActivateIfClosedId && tabToActivateIfClosedId !== undefined) {
            console.log(`onTabActivated::will manually activate tab because of close`);
            tabToManuallyActivateId = tabToActivateIfClosedId;
          }
        } else if (previousLastActiveTabGroupWasCollapsed) {
          const tabToActivateIfTabGroupCollapsedId = previousLastActiveTabGroupWasCollapsed
            ? await ActiveWindow.getTabToActivateIfTabGroupCollapsed(tabs, previousLastActiveTabInfo.tabGroupId)
            : undefined;
          if (tab.id !== tabToActivateIfTabGroupCollapsedId && tabToActivateIfTabGroupCollapsedId !== undefined) {
            console.log(`onTabActivated::will manually activate tab because of collapse`);
            tabToManuallyActivateId = tabToActivateIfTabGroupCollapsedId;
          }
        }

        if (tabToManuallyActivateId !== null) {
          manualTabActivationOperationInfo = tab.id;
          await ActiveWindow.manuallyActivateTab(tabToManuallyActivateId, lastUndiscardedTabInfo === tab.id ? tab.id : undefined);
          return;
        }
      }

      // 5
      const updatedTab = await ActiveWindow.updateTabOpenerIdToTabToActivateIfClosed(tabs, {
        tabId: tab.id,
        tabGroupId: tab.groupId,
        openerTabId: tab.openerTabId,
        title: tab.title,
      });
      tab = updatedTab ? updatedTab : tab;

      // 6
      let shouldMakePrimaryNow: boolean;
      console.log(
        `onTabActivated::previousCreatedTabGroupingOperationInfo:`,
        previousCreatedTabGroupingOperationInfo?.tabId,
        previousCreatedTabGroupingOperationInfo?.tabId === activeInfo.tabId
      );
      if (previousCreatedTabGroupingOperationInfo && previousCreatedTabGroupingOperationInfo.tabId === activeInfo.tabId) {
        tab.groupId = previousCreatedTabGroupingOperationInfo.tabGroupId;
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
        await ActiveWindow.enablePrimaryTabTriggerForTab(tab.id, shouldMakePrimaryNow);
      }
      resultingLastActiveTabInfo = { tabId: tab.id, tabGroupId: tab.groupId, title: tab.title };
    } catch (error) {
      console.error(`onTabActivated::tabGroupIdPromise::error resolving promise with selected tab group:${error}`);
    } finally {
      resolve(resultingLastActiveTabInfo);
    }
  });
}

export async function onTabCreated(tab: chrome.tabs.Tab) {
  if (!tab.id) {
    console.warn(`onTabCreated::tabId not found for tab:`, tab);
    return;
  }

  createdTabGroupingOperationInfo = new Promise(async (resolve) => {
    let resultingCreatedTabGroupingOperationInfo: { tabId: ChromeTabId; tabGroupId: ChromeTabGroupId } | null = null;
    try {
      console.log(`onTabCreated::tab:`, tab.title);

      const [previousLastActiveTabInfo, previousCreatedTabGroupingOperationInfo] = await Promise.all([
        lastActiveTabInfo,
        createdTabGroupingOperationInfo,
      ]);
      resultingCreatedTabGroupingOperationInfo = previousCreatedTabGroupingOperationInfo;

      console.log(`onTabCreated::lastActiveTabInfo:`, previousLastActiveTabInfo?.title || "N/A");

      const activeWindowId = await ActiveWindow.getKey(tab.windowId);
      if (!activeWindowId) {
        console.warn(`onTabCreated::activeWindow not found for windowId:`, tab.windowId);
        return;
      }

      // 1. if the tab is not in a group, and the last active tab was in a group, add the tab to the last active tab group

      // 1
      if (
        previousLastActiveTabInfo &&
        tab.groupId === chrome.tabGroups.TAB_GROUP_ID_NONE &&
        previousLastActiveTabInfo.tabGroupId !== chrome.tabGroups.TAB_GROUP_ID_NONE
      ) {
        console.log(`onTabCreated::adding created tab '${tab.title}' to last active tab group: '${previousLastActiveTabInfo.title}'`);
        // FIXME: the ts compiler is not recognizing that tab.id is not null
        const tabGroupId = await chrome.tabs.group({ tabIds: tab.id!, groupId: previousLastActiveTabInfo.tabGroupId });
        resultingCreatedTabGroupingOperationInfo = { tabId: tab.id!, tabGroupId };
      }
    } catch (error) {
      console.error(`onTabCreated::tabGroupIdPromise::error resolving promise with selected tab group:${error}`);
    } finally {
      resolve(resultingCreatedTabGroupingOperationInfo);
    }
  });
}

export async function onTabUpdated(tabId: ChromeTabId, changeInfo: chrome.tabs.TabChangeInfo, tab: chrome.tabs.Tab) {
  const validChangeInfo: Array<keyof chrome.tabs.TabChangeInfo> = ["discarded", "groupId"];
  if (!validChangeInfo.find((key) => changeInfo[key] !== undefined)) {
    return;
  }

  console.log(`onTabUpdated::title, changeInfo and id:`, tab.title, changeInfo, tab.id);

  lastActiveTabInfo = new Promise(async (resolve) => {
    let resultingLastActiveTabInfo: LastActiveTabInfo | null = null;
    try {
      // 1. reset lastUndiscardedTabInfo
      // 2. update lastActiveTabInfo
      // 3. if the tab has been un-discarded, update lastUndiscardedTabInfo
      // 4. if the tab has been un-discarded, discard the tab if a manual tab activation is taking place

      // 1
      lastUndiscardedTabInfo = null;

      const previousLastActiveTabInfo = await lastActiveTabInfo;
      resultingLastActiveTabInfo = previousLastActiveTabInfo;

      const myManualTabActivationOperationInfo = manualTabActivationOperationInfo;
      console.log(`onTabsUpdated::lastActiveTabInfo:`, previousLastActiveTabInfo?.title || "N/A");
      const activeWindowId = await ActiveWindow.getKey(tab.windowId);
      if (!activeWindowId) {
        console.warn(`onTabsUpdated::activeWindow not found for windowId:`, tab.windowId);
        return;
      }

      // 2
      // we check if the tab still exists because the chrome.tabs.onUpdated event gets called with groupId = -1 when the tab is removed, and we
      //  dont want to forget which tab group the removed tab belonged to in lastActiveTabInfo
      if (
        previousLastActiveTabInfo &&
        previousLastActiveTabInfo.tabId === tabId &&
        changeInfo.groupId !== undefined &&
        (await ChromeWindowHelper.doesTabExist(tabId))
      ) {
        resultingLastActiveTabInfo = { ...previousLastActiveTabInfo, tabGroupId: changeInfo.groupId };
      }

      if (changeInfo.discarded === false) {
        // 3
        lastUndiscardedTabInfo = tabId;

        // 4
        if (myManualTabActivationOperationInfo === tabId) {
          console.log(`onTabsUpdated::discarding tab due to manual tab activation:`, tabId);
          await ChromeWindowHelper.discardTabIfNotDiscarded(tabId);
        }
      }
    } catch (error) {
      console.error(`onTabUpdated::error resolving promise with selected tab group:${error}`);
    } finally {
      resolve(resultingLastActiveTabInfo);
    }
  });
}

export async function onTabRemoved(tabId: ChromeTabId, removeInfo: chrome.tabs.TabRemoveInfo) {
  console.log(`onTabRemoved::tabId:`, tabId, removeInfo);
  const activeWindowId = await ActiveWindow.getKey(removeInfo.windowId);
  if (!activeWindowId) {
    console.warn(`onTabRemoved::activeWindow not found for windowId:`, removeInfo.windowId);
    return;
  }

  if (removeInfo.isWindowClosing) {
    console.log(`onTabRemoved::window is closing, nothing to do:`, tabId);
    return;
  }
}

export async function onTabMoved(tabId: ChromeTabId, moveInfo: chrome.tabs.TabMoveInfo) {
  console.log(`onTabMoved::tabId and moveInfo:`, tabId, moveInfo);
  const activeWindowId = await ActiveWindow.getKey(moveInfo.windowId);
  if (!activeWindowId) {
    console.warn(`onTabMoved::activeWindow not found for windowId:`, moveInfo.windowId);
    return;
  }

  let tab = (await chrome.tabs.get(tabId)) as ChromeTabWithId;
  console.log(`onTabMoved::title and groupId:`, tab.title, tab.groupId);

  // update the tab's opener tab id to the tab to activate if closed
  const updatedTab = await ActiveWindow.updateTabOpenerIdToTabToActivateIfClosed(tab.windowId, {
    tabId: tab.id,
    tabGroupId: tab.groupId,
    openerTabId: tab.openerTabId,
    title: tab.title,
  });
  tab = updatedTab ? updatedTab : tab;
}

export async function onTabReplaced(addedTabId: ChromeTabId, removedTabId: ChromeTabId) {
  console.log(`onTabReplaced::addedTabId and removedTabId:`, addedTabId, removedTabId);
  lastActiveTabInfo = new Promise(async (resolve) => {
    let resultingLastActiveTabInfo: LastActiveTabInfo | null = null;
    try {
      const previousLastActiveTabInfo = await lastActiveTabInfo;
      resultingLastActiveTabInfo = previousLastActiveTabInfo;

      if (previousLastActiveTabInfo?.tabId === removedTabId) {
        const tab = (await chrome.tabs.get(addedTabId)) as ChromeTabWithId;
        resultingLastActiveTabInfo = {
          tabId: tab.id,
          tabGroupId: tab.groupId,
          title: tab.title,
        };
      }
    } catch (error) {
      console.error(`onTabReplaced::error resolving promise with selected tab group:${error}`);
    } finally {
      resolve(resultingLastActiveTabInfo);
    }
  });
}

export async function onWindowFocusChanged(windowId: number) {
  console.log(`onWindowFocusChanged::windowId:`, windowId);
  lastActiveTabInfo = new Promise(async (resolve) => {
    let resultingLastActiveTabInfo: LastActiveTabInfo | null = null;
    try {
      const previousLastActiveTabInfo = await lastActiveTabInfo;
      resultingLastActiveTabInfo = previousLastActiveTabInfo;
      console.log(`onWindowFocusChanged::lastActiveTabInfo:`, previousLastActiveTabInfo?.title || "N/A");
      if (windowId === chrome.windows.WINDOW_ID_NONE) {
        return;
      }

      const window = (await chrome.windows.get(windowId)) as ChromeWindowWithId;
      if (window.type !== "normal") {
        return;
      }

      // 1. if there is no previous active tab info, or the active tab is not the same as the last active tab, update lastActiveTabInfo

      const [activeTab] = (await chrome.tabs.query({
        active: true,
        windowId,
      })) as ChromeTabWithId[];

      if (!activeTab) {
        console.warn(`onWindowFocusChanged::activeTab not found for windowId:`, windowId);
        return;
      }

      // 1
      if (!previousLastActiveTabInfo || activeTab.id !== previousLastActiveTabInfo.tabId) {
        resultingLastActiveTabInfo = { tabId: activeTab.id, tabGroupId: activeTab.groupId, title: activeTab.title };
      }
    } catch (error) {
      console.error(`onWindowFocusChanged::error resolving promise with selected tab group:${error}`);
    } finally {
      resolve(resultingLastActiveTabInfo);
    }
  });
}
