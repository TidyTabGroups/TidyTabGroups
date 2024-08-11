import ChromeWindowHelper from "../chromeWindowHelper";
import Logger from "../logger";
import Misc from "../misc";
import { ActiveWindow } from "../model";
import Types from "../types";
import { ChromeTabGroupId, ChromeTabGroupWithId, ChromeTabId, ChromeTabWithId, ChromeWindowId, ChromeWindowWithId } from "../types/types";
import * as Storage from "../storage";

const logger = Logger.createLogger("activeWindowEvents", { color: "#4287f5" });

export async function onWindowCreated(window: ChromeWindowWithId) {
  logger.log(`onWindowCreated::window:`, window);

  try {
    const newActiveWindow = await ActiveWindow.activateWindow(window.id, true);
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

export async function onWindowFocusChanged(windowId: ChromeWindowId) {
  // 1. update the lastSeenFocusModeColors
  // 2. use tab title for eligeble tab groups
  const myLogger = logger.createNestedLogger("onWindowFocusChanged");
  myLogger.log(`windowId: ${windowId}`);
  try {
    // 1
    const activeWindow = await ActiveWindow.get(windowId);
    if (activeWindow) {
      let keys: Partial<Types.LocalStorageShape> = {};
      if (activeWindow.focusMode) {
        keys = { ...keys, lastSeenFocusModeColors: activeWindow.focusMode.colors };
      }
      await Storage.setItems({ ...keys, lastFocusedWindowHadFocusMode: activeWindow.focusMode !== null });
    }

    // 2
    await ActiveWindow.useTabTitleForEligebleTabGroups();
  } catch (error) {
    throw new Error(myLogger.getPrefixedMessage(`error:${error}`));
  }
}

export async function onTabGroupCreated(activeWindow: Types.ActiveWindow, tabGroup: chrome.tabGroups.TabGroup) {
  const myLogger = logger.createNestedLogger("onTabGroupCreated");
  // 1. adjust the tab group's color based on the active window's focus mode
  // 2. if the tab group's title is empty, set the ActiveWindowTabGroup's useTabTitle to true
  // 3. add the ActiveWindowTabGroup
  myLogger.log(`tabGroup:`, tabGroup.id, tabGroup.title, tabGroup.collapsed, tabGroup.color);
  try {
    const existingActiveWindowTabGroup = activeWindow.tabGroups.find((otherTabGroup) => otherTabGroup.id === tabGroup.id);
    if (existingActiveWindowTabGroup) {
      myLogger.log(`tabGroup already exists in activeWindow:`, tabGroup.id);
      return;
    }

    let tabGroupUpToDate = await ChromeWindowHelper.getIfTabGroupExists(tabGroup.id);
    if (!tabGroupUpToDate) {
      myLogger.warn(`(1) tabGroupUpToDate not found for tabGroup:${tabGroup.id}`);
      return;
    }

    await ActiveWindow.createActiveWindowTabGroup(activeWindow.windowId, tabGroupUpToDate);
  } catch (error) {
    throw new Error(myLogger.getPrefixedMessage(`error:${error}`));
  }
}

export async function onTabGroupRemoved(activeWindow: Types.ActiveWindow, tabGroup: chrome.tabGroups.TabGroup) {
  const myLogger = logger.createNestedLogger("onTabGroupRemoved");
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
  const myLogger = logger.createNestedLogger("onTabGroupUpdated");
  // 1. handle the case where the tab group's focus mode color is overridden
  //      due to a chromium bug when creating new tab groups
  // 2. if the tab group is focused, update the active window's focus mode focused color
  // 3. if the tab group is NOT focused, update the active window's focus mode nonFocused color
  // 4. if the tab group was expanded, focus the tab group
  // 5. if the tab group was expanded, activate the last active tab in the group
  // 6. if the tab group's title is updated, then set it's useSetTabTitle to false
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

    const isTabGroupUpToDate = ChromeWindowHelper.tabGroupEquals(tabGroup, tabGroupUpToDate);
    if (!isTabGroupUpToDate) {
      // let the most up to date onTabGroupUpdated event handle this operation
      myLogger.warn(`tabGroup is not up to date, ignoring operation`);
      return;
    }

    const wasCollapsed = tabGroupUpToDate.collapsed && !activeWindowTabGroup.collapsed;
    const wasExpanded = !tabGroupUpToDate.collapsed && activeWindowTabGroup.collapsed;
    const wasColorUpdated = tabGroupUpToDate.color !== activeWindowTabGroup.color;
    const wasTitleUpdated = tabGroupUpToDate.title !== activeWindowTabGroup.title;

    const getUserPreferences = Misc.lazyCall(async () => {
      return (await Storage.getItems("userPreferences")).userPreferences;
    });

    if (activeWindow.focusMode && wasColorUpdated) {
      if (wasTitleUpdated) {
        // 1
        // FIXME: this is a workaround for a chromium bug where updating the title of a newly created tab group
        // causes the color to be reset back to its original color. We need to reset back to it's previous color.
        // Remove once the Chromium bug is fixed: https://issues.chromium.org/issues/334965868
        tabGroupUpToDate = await ChromeWindowHelper.updateTabGroup(tabGroup.id, { color: activeWindowTabGroup.color });
        await ActiveWindow.updateActiveWindowTabGroup(tabGroup.windowId, tabGroup.id, { color: tabGroupUpToDate.color });
      } else {
        const activeTab = (await chrome.tabs.query({ windowId: tabGroup.windowId, active: true }))[0] as ChromeTabWithId | undefined;
        if (activeTab) {
          const focusedTabGroupId = activeTab.groupId;
          const isFocusedTabGroup = tabGroup.id === focusedTabGroupId;
          let newFocusModeColors;

          if (isFocusedTabGroup) {
            // 2
            newFocusModeColors = { ...activeWindow.focusMode.colors, focused: tabGroupUpToDate.color };
            await ActiveWindow.update(activeWindow.windowId, { focusMode: { ...activeWindow.focusMode, colors: newFocusModeColors } });
          } else {
            // 3
            newFocusModeColors = { ...activeWindow.focusMode.colors, nonFocused: tabGroupUpToDate.color };
            await ActiveWindow.update(activeWindow.windowId, { focusMode: { ...activeWindow.focusMode, colors: newFocusModeColors } });
            // this will effectively update the color of all other non-focused tab groups
            await ActiveWindow.focusTabGroup(activeWindow.windowId, focusedTabGroupId);
          }

          const window = await ChromeWindowHelper.getIfWindowExists(tabGroup.windowId);
          if (window?.focused) {
            await Storage.setItems({ lastSeenFocusModeColors: newFocusModeColors });
          }
        } else {
          myLogger.warn(`could not find activeTab in windowId: ${tabGroup.windowId}`);
        }
      }
    }

    tabGroupUpToDate = await ChromeWindowHelper.getIfTabGroupExists(tabGroup.id);
    if (!tabGroupUpToDate) {
      myLogger.warn(`(2) tabGroupUpToDate not found for tabGroup:${tabGroup.id}`);
      return;
    }

    if (
      wasExpanded &&
      !tabGroupUpToDate.collapsed &&
      (await getUserPreferences()).activateTabInFocusedTabGroup &&
      !(await chrome.tabs.query({ windowId: tabGroup.windowId, groupId: tabGroup.id, active: true }))[0]
    ) {
      // 4
      await ActiveWindow.focusTabGroup(activeWindow.windowId, tabGroup.id);

      // 5
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
      const timeToWaitBeforeActivation = Misc.serviceWorkerJustWokeUp() ? 100 : 250;
      await Misc.waitMs(timeToWaitBeforeActivation);

      tabGroupUpToDate = await ChromeWindowHelper.getIfTabGroupExists(tabGroup.id);
      if (!tabGroupUpToDate) {
        myLogger.warn(`(3) tabGroupUpToDate not found for tabGroup:${tabGroup.id}`);
        return;
      }

      if (!tabGroupUpToDate.collapsed) {
        await ChromeWindowHelper.activateTabWithRetryHandler(tabToActivate.id);
      }
    }

    // 6
    if (wasTitleUpdated) {
      await ActiveWindow.updateActiveWindowTabGroup(activeWindow.windowId, tabGroup.id, { useTabTitle: false });
    }
  } catch (error) {
    throw new Error(myLogger.getPrefixedMessage(`error:${error}`));
  }
}

export async function onTabCreated(activeWindow: Types.ActiveWindow, tab: chrome.tabs.Tab) {
  const myLogger = logger.createNestedLogger("onTabCreated");
  // 1. check if the the tab was updated or removed
  // 2. get the lastActiveTab
  // 3. if the tab is not pinned nor in a group, and the last active tab was in a group, add the tab to the last active tab group
  // 4. if the tab is not pinned nor in a group, create a group for it
  myLogger.log(`tab:`, tab.title, tab.groupId);

  if (!tab.id) {
    myLogger.warn(`tabId not found for tab:`, tab);
    return;
  }

  try {
    const tabsUpToDate = (await chrome.tabs.query({ windowId: tab.windowId })) as ChromeTabWithId[];
    // 1
    const tabIndex = tabsUpToDate.findIndex((otherTab) => otherTab.id === tab.id);
    const tabUpToDate = tabsUpToDate[tabIndex];
    if (!tabUpToDate) {
      myLogger.warn(`tabUpToDate not found for tabId:`, tab.id);
      return;
    }

    // 2
    const tabsOrderedByLastAccessed = await ChromeWindowHelper.getTabsOrderedByLastAccessed(tabsUpToDate);
    let lastActiveTab: ChromeTabWithId | undefined;
    // the last active tab could be this tab if it is activated, in that case, get the previous last active tab
    if (tabsOrderedByLastAccessed[tabsOrderedByLastAccessed.length - 1]?.id === tab.id) {
      lastActiveTab = tabsOrderedByLastAccessed[tabsOrderedByLastAccessed.length - 2] as ChromeTabWithId | undefined;
    } else {
      lastActiveTab = tabsOrderedByLastAccessed[tabsOrderedByLastAccessed.length - 1] as ChromeTabWithId | undefined;
    }

    if (!tabUpToDate.pinned && tabUpToDate.groupId === chrome.tabGroups.TAB_GROUP_ID_NONE) {
      let existingGroupId: ChromeTabGroupId | undefined | null = null;
      if (lastActiveTab && lastActiveTab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE) {
        if ((await Storage.getItems("userPreferences")).userPreferences.addNewTabToFocusedTabGroup) {
          // 3
          myLogger.log(`adding created tab '${tab.title}' to last active tab group: '${lastActiveTab.title}'`);
          existingGroupId = lastActiveTab.groupId;
        }
      } else {
        // 4
        // TODO: check for `automatically group created tabs` user preference
        myLogger.log(`creating new tab group for tab: '${tab.title}'`);
        existingGroupId = undefined;
      }

      if (existingGroupId !== null) {
        const createNewGroup = existingGroupId === undefined;
        const groupId = await ChromeWindowHelper.groupTabs({
          createProperties: createNewGroup ? { windowId: tab.windowId } : undefined,
          groupId: createNewGroup ? undefined : existingGroupId,
          tabIds: tab.id,
        });
        tabUpToDate.groupId = groupId;

        if (createNewGroup) {
          const newTabGroup = await ChromeWindowHelper.getIfTabGroupExists(groupId);
          if (newTabGroup) {
            await ActiveWindow.createActiveWindowTabGroup(activeWindow.windowId, newTabGroup);
          }
        }
      }
    }
  } catch (error) {
    throw new Error(myLogger.getPrefixedMessage(`error:${error}`));
  }
}

export async function onTabActivated(activeWindow: Types.ActiveWindow, activeInfo: chrome.tabs.TabActiveInfo) {
  const myLogger = logger.createNestedLogger("onTabActivated");
  // 1. focus the tab's group

  myLogger.log(`activeInfo.tabId: `, activeInfo.tabId);

  try {
    const tabUpToDate = await ChromeWindowHelper.getIfTabExists(activeInfo.tabId);
    if (!tabUpToDate || !tabUpToDate.id) {
      myLogger.warn(`tabUpToDate not found for tabId:`, activeInfo.tabId);
      return;
    }

    if (!tabUpToDate.active) {
      myLogger.warn(`tabUpToDate no longer active:`, tabUpToDate.title);
      return;
    }

    myLogger.log(`title and groupId:`, tabUpToDate.title, tabUpToDate.groupId);

    // 1
    await ActiveWindow.focusActiveTab(tabUpToDate.windowId, tabUpToDate.id, tabUpToDate.groupId);
  } catch (error) {
    throw new Error(myLogger.getPrefixedMessage(`error:${error}`));
  }
}

export async function onTabUpdated(activeWindow: Types.ActiveWindow, tab: ChromeTabWithId, changeInfo: chrome.tabs.TabChangeInfo) {
  // 1. if the tab's group changed and the tab is active, focus the tab's group
  // 2. if the tab was ungrouped or unpinned, create a new group for it
  // 3. if the tab's title or group was changed, use tab title for eligeble tab groups
  const myLogger = logger.createNestedLogger("onTabUpdated");
  myLogger.log(`title, changeInfo and id:`, tab.title, changeInfo, tab.id);

  try {
    // 1
    if (changeInfo.groupId !== undefined && tab.active) {
      await ActiveWindow.focusActiveTab(tab.windowId, tab.id, tab.groupId);
      // wait for the potential tab group collapse animation of other groups to finish before doing anything else.
      // Note, this can be changed to run conditionally based on whether the any tab group was actually collapsed.
      await Misc.waitMs(350);
    }

    // 2
    const wasUngrouped = changeInfo.groupId === chrome.tabGroups.TAB_GROUP_ID_NONE && !tab.pinned;
    const wasUnpinned = changeInfo.pinned === false && tab.groupId === chrome.tabGroups.TAB_GROUP_ID_NONE;
    if (wasUngrouped || wasUnpinned) {
      // TODO: check for `automatically group created tabs` user preference
      // FIXME: if a non-grouped tab is active, and the user didnt explicitly ungroup it (e.g. by right-clicking and
      //  selecting "remove from group" on the tab of this event), it will be apart of highlightedTabs, which is undesired behavior.
      //  In order to fix this, we need to properly identify which other tabs the user explicitly ungrouped
      const highlightedTabs = (await chrome.tabs.query({
        windowId: tab.windowId,
        highlighted: true,
        groupId: chrome.tabGroups.TAB_GROUP_ID_NONE,
      })) as ChromeTabWithId[];
      await ActiveWindow.groupHighlightedTabs(tab.windowId, [tab.id, ...highlightedTabs.map((tab) => tab.id)]);
    }

    if (changeInfo.groupId !== undefined || changeInfo.title !== undefined) {
      // 3
      await ActiveWindow.useTabTitleForEligebleTabGroups();
    }
  } catch (error) {
    throw new Error(myLogger.throwPrefixed(`error:${error}`));
  }
}

export async function onTabAttached(activeWindow: Types.ActiveWindow, tab: ChromeTabWithId) {
  const myLogger = logger.createNestedLogger("onTabAttached");
  myLogger.log(`tab attached to windowId: ${tab.windowId}, tab title: ${tab.title}`);

  try {
    if (tab.active) {
      await ActiveWindow.focusActiveTab(tab.windowId, tab.id, tab.groupId);
    }
  } catch (error) {
    throw new Error(myLogger.getPrefixedMessage(`error:${error}`));
  }
}

export async function onTabDetached(activeWindow: Types.ActiveWindow, tab: ChromeTabWithId) {
  const myLogger = logger.createNestedLogger("onTabDetached");
  myLogger.log(`tab detached from windowId: ${tab.windowId}, tab title: ${tab.title}`);

  try {
    await ActiveWindow.blurTabGroupsIfNoActiveTab(activeWindow.windowId);
  } catch (error) {
    throw new Error(myLogger.getPrefixedMessage(Misc.getErrorMessage(error)));
  }
}

export async function onTabRemoved(activeWindow: Types.ActiveWindow, tabId: ChromeTabId, removeInfo: chrome.tabs.TabRemoveInfo) {
  const myLogger = logger.createNestedLogger("onTabRemoved");
  myLogger.log(`tabId:`, tabId, removeInfo);

  if (removeInfo.isWindowClosing) {
    myLogger.log(`window is closing, nothing to do:`, tabId);
    return;
  }

  try {
    await ActiveWindow.blurTabGroupsIfNoActiveTab(activeWindow.windowId);
  } catch (error) {
    throw new Error(myLogger.getPrefixedMessage(Misc.getErrorMessage(error)));
  }
}

export async function onTabMoved(activeWindow: Types.ActiveWindow, tabId: ChromeTabId, moveInfo: chrome.tabs.TabMoveInfo) {
  const myLogger = logger.createNestedLogger("onTabMoved");
  myLogger.log(`tabId and moveInfo:`, tabId, moveInfo);
}

export async function onTabReplaced(activeWindow: Types.ActiveWindow, addedTabId: ChromeTabId, removedTabId: ChromeTabId) {
  const myLogger = logger.createNestedLogger("onTabReplaced");
  myLogger.log(`addedTabId and removedTabId:`, addedTabId, removedTabId);
}

async function onPageFocused(activeWindow: Types.ActiveWindow, tabId: ChromeTabId) {
  // 1. if the tab is pinned, ignore
  // 2. if the tab is active, reposition it
  // 3. use tab title for eligeble tab groups
  const myLogger = logger.createNestedLogger("onPageFocused");
  const tabUpToDate = await ChromeWindowHelper.getIfTabExists(tabId);
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
    await ActiveWindow.repositionTab(tabUpToDate.windowId, tabUpToDate.id);
    // 3
    await ActiveWindow.useTabTitleForEligebleTabGroups();
  } else {
    myLogger.warn("pageFocused::tab is not active:", tabUpToDate.title);
  }
}

export async function onMouseInPageStatusChanged(activeWindow: Types.ActiveWindow, tab: ChromeTabWithId, status: Types.MouseInPageStatus) {
  const myLogger = logger.createNestedLogger("onMouseInPageStatusChanged");
  myLogger.log(`tabId:`, tab.id, status);
  if (status === "entered") {
    await ActiveWindow.useTabTitleForEligebleTabGroups();
  } else if (status === "focused") {
    await onPageFocused(activeWindow, tab.id);
  }
}
