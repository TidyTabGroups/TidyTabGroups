import ChromeWindowHelper from "../chromeWindowHelper";
import Logger from "../logger";
import Misc from "../misc";
import { ActiveWindow } from "../model";
import Types from "../types";
import {
  ChromeTabGroupChangeInfo,
  ChromeTabGroupId,
  ChromeTabGroupWithId,
  ChromeTabId,
  ChromeTabWithId,
  ChromeWindowId,
  ChromeWindowWithId,
} from "../types/types";
import * as Storage from "../storage";
import { runActiveWindowTabGroupOperation, runActiveWindowTabOperation } from "./ActiveWindowEventOperationRunner";

const logger = Logger.createLogger("ActiveWindowEventHandlers", { color: "#4287f5" });

export async function onWindowCreated(window: ChromeWindowWithId) {
  const myLogger = logger.createNestedLogger("onWindowCreated");
  myLogger.log(`window:`, window);

  try {
    const newActiveWindow = await ActiveWindow.activateWindow(window.id, true);
    myLogger.log(`newActiveWindow:`, newActiveWindow);
  } catch (error) {
    throw new Error(myLogger.getPrefixedMessage(`error:${error}`));
  }
}

export async function onWindowRemoved(activeWindow: Types.ActiveWindow) {
  const { windowId } = activeWindow;

  const myLogger = logger.createNestedLogger("onWindowRemoved");
  myLogger.log(`windowId:`, windowId);

  try {
    await ActiveWindow.deactivateWindow(windowId);
    myLogger.log(`deactivated window:`, windowId);
  } catch (error) {
    throw new Error(myLogger.getPrefixedMessage(`error:${error}`));
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
  myLogger.log(`tabGroup:`, tabGroup.id, tabGroup.title, tabGroup.collapsed, tabGroup.color);
  try {
    const existingActiveWindowTabGroup = activeWindow.tabGroups.find((otherTabGroup) => otherTabGroup.id === tabGroup.id);
    if (existingActiveWindowTabGroup) {
      myLogger.log(`tabGroup already exists in activeWindow:`, tabGroup.id);
      return;
    }

    await ActiveWindow.createActiveWindowTabGroup(activeWindow.windowId, tabGroup);
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

export async function onTabGroupUpdated(
  activeWindow: Types.ActiveWindow,
  activeWindowTabGroup: Types.ActiveWindowTabGroup,
  tabGroup: chrome.tabGroups.TabGroup,
  changeInfo: ChromeTabGroupChangeInfo
) {
  const myLogger = logger.createNestedLogger("onTabGroupUpdated");
  // 1. handle the case where the tab group's focus mode color is overridden
  //      due to a chromium bug when creating new tab groups
  // 2. if the tab group is focused, update the active window's focus mode focused color
  // 3. if the tab group is NOT focused, update the active window's focus mode nonFocused color
  // 4. if the tab group was expanded, set ActiveWindowTabGroup.collapsed to false
  // 5. if the tab group was expanded, activate the last active tab in the group
  // 6. if the tab group's title is updated, then set it's useSetTabTitle to false
  try {
    const wasColorUpdated = changeInfo.color !== undefined;
    const wasExpanded = changeInfo.collapsed === false;
    const wasCollapsed = changeInfo.collapsed === true;
    const wasTitleUpdated = changeInfo.title !== undefined;

    myLogger.log(`id: ${tabGroup.id}, title: ${tabGroup.title}`);

    const getUserPreferences = Misc.lazyCall(async () => {
      return (await Storage.getItems("userPreferences")).userPreferences;
    });

    if (wasColorUpdated) {
      await runActiveWindowTabGroupOperation(tabGroup.id, async ({ tabGroup }) => {
        const isStillColorUpdated = tabGroup.color === changeInfo.color;
        if (!isStillColorUpdated) {
          return;
        }

        await ActiveWindow.updateActiveWindowTabGroup(activeWindow.windowId, tabGroup.id, { color: changeInfo.color });

        if (activeWindow.focusMode === null) {
          return;
        }

        const isTitleStillUpdated = tabGroup.title === changeInfo.title;
        if (isTitleStillUpdated) {
          // 1
          // FIXME: this is a workaround for a chromium bug where updating the title of a newly created tab group
          // causes the color to be reset back to its original color. We need to reset back to it's previous color.
          // Remove once the Chromium bug is fixed: https://issues.chromium.org/issues/334965868
          const tabGroupUpToDate = await ChromeWindowHelper.updateTabGroupWithRetryHandler(tabGroup.id, { color: activeWindowTabGroup.color });
          if (!tabGroupUpToDate) {
            return;
          }

          await ActiveWindow.updateActiveWindowTabGroup(tabGroup.windowId, tabGroup.id, { color: tabGroupUpToDate.color });
        } else {
          const activeTab = (await chrome.tabs.query({ windowId: tabGroup.windowId, active: true }))[0] as ChromeTabWithId | undefined;
          if (activeTab) {
            const focusedTabGroupId = activeTab.groupId;
            const isFocusedTabGroup = tabGroup.id === focusedTabGroupId;
            let newFocusModeColors;

            if (isFocusedTabGroup) {
              // 2
              newFocusModeColors = { ...activeWindow.focusMode.colors, focused: tabGroup.color };
              await ActiveWindow.update(activeWindow.windowId, { focusMode: { ...activeWindow.focusMode, colors: newFocusModeColors } });
            } else {
              // 3
              newFocusModeColors = { ...activeWindow.focusMode.colors, nonFocused: tabGroup.color };
              await ActiveWindow.update(activeWindow.windowId, { focusMode: { ...activeWindow.focusMode, colors: newFocusModeColors } });
              // this will effectively update the color of all other non-focused tab groups
              await ActiveWindow.focusTabGroup(activeWindow.windowId, focusedTabGroupId);
            }

            const window = await ChromeWindowHelper.getIfWindowExists(tabGroup.windowId);
            if (window?.focused) {
              await Storage.setItems({ lastSeenFocusModeColors: newFocusModeColors });
            }
          }
        }
      });
    }

    if (wasExpanded) {
      await runActiveWindowTabGroupOperation(tabGroup.id, async ({ tabGroup }) => {
        const isStillExpanded = !tabGroup.collapsed;
        if (!isStillExpanded) {
          return;
        }

        // 4: Set ActiveWindowTabGroup.collapsed to false
        await ActiveWindow.updateActiveWindowTabGroup(activeWindow.windowId, tabGroup.id, { collapsed: false });

        const [activeTabInGroup] = await chrome.tabs.query({ windowId: tabGroup.windowId, groupId: tabGroup.id, active: true });
        if (!activeTabInGroup && (await getUserPreferences()).activateTabInFocusedTabGroup) {
          // 5
          const tabsInGroup = (await chrome.tabs.query({ windowId: tabGroup.windowId, groupId: tabGroup.id })) as ChromeTabWithId[];
          if (tabsInGroup.length === 0) {
            // TODO: return instead of throwing an error
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

          const tabGroupUpToDate = await ChromeWindowHelper.getIfTabGroupExists(tabGroup.id);
          if (!tabGroupUpToDate) {
            return;
          }

          if (!tabGroupUpToDate.collapsed) {
            await ChromeWindowHelper.activateTabWithRetryHandler(tabToActivate.id);
          }
        }
      });
    }

    if (wasCollapsed) {
      await runActiveWindowTabGroupOperation(tabGroup.id, async ({ tabGroup }) => {
        const isStillCollapsed = tabGroup.collapsed;
        if (isStillCollapsed) {
          await ActiveWindow.updateActiveWindowTabGroup(activeWindow.windowId, tabGroup.id, { collapsed: true });
        }
      });
    }

    // 6
    if (wasTitleUpdated) {
      await runActiveWindowTabGroupOperation(tabGroup.id, async ({ tabGroup }) => {
        const isStillTitleUpdated = tabGroup.title === changeInfo.title;
        if (isStillTitleUpdated) {
          await ActiveWindow.updateActiveWindowTabGroup(activeWindow.windowId, tabGroup.id, { title: tabGroup.title, useTabTitle: false });
        }
      });
    }
  } catch (error) {
    throw new Error(myLogger.getPrefixedMessage(`error:${error}`));
  }
}

export async function onTabCreated(tabId: ChromeTabId) {
  const myLogger = logger.createNestedLogger("onTabCreated");
  // 1. get the lastActiveTab
  // 2. if the tab is not pinned nor in a group, and the last active tab was in a group, add the tab to the last active tab group
  // 3. if the tab is not pinned nor in a group, create a group for it

  try {
    await runActiveWindowTabOperation(tabId, async ({ activeWindow, tab }) => {
      // 1
      const tabs = (await chrome.tabs.query({ windowId: tab.windowId })) as ChromeTabWithId[];
      const tabsOrderedByLastAccessed = await ChromeWindowHelper.getTabsOrderedByLastAccessed(tabs);
      let lastActiveTab: ChromeTabWithId | undefined;
      // the last active tab could be this tab if it is activated, in that case, get the previous last active tab
      if (tabsOrderedByLastAccessed[tabsOrderedByLastAccessed.length - 1]?.id === tab.id) {
        lastActiveTab = tabsOrderedByLastAccessed[tabsOrderedByLastAccessed.length - 2] as ChromeTabWithId | undefined;
      } else {
        lastActiveTab = tabsOrderedByLastAccessed[tabsOrderedByLastAccessed.length - 1] as ChromeTabWithId | undefined;
      }

      if (!tab.pinned && tab.groupId === chrome.tabGroups.TAB_GROUP_ID_NONE) {
        let existingGroupId: ChromeTabGroupId | undefined | null = null;
        if (lastActiveTab && lastActiveTab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE) {
          if ((await Storage.getItems("userPreferences")).userPreferences.addNewTabToFocusedTabGroup) {
            // 2
            myLogger.log(`adding created tab '${tab.title}' to last active tab group: '${lastActiveTab.title}'`);
            existingGroupId = lastActiveTab.groupId;
          }
        } else {
          // 3
          // TODO: check for `automatically group created tabs` user preference
          myLogger.log(`creating new tab group for tab: '${tab.title}'`);
          existingGroupId = undefined;
        }

        if (existingGroupId !== null) {
          const createNewGroup = existingGroupId === undefined;
          // TODO: Re-use logic in ActiveWindow.autoGroupTabAndHighlightedTabs instead of or adjecent to this
          const groupId = await ChromeWindowHelper.groupTabsWithRetryHandler({
            createProperties: createNewGroup ? { windowId: tab.windowId } : undefined,
            groupId: createNewGroup ? undefined : existingGroupId,
            tabIds: tab.id,
          });

          if (groupId !== undefined) {
            tab.groupId = groupId;

            if (createNewGroup) {
              const newTabGroup = await ChromeWindowHelper.getIfTabGroupExists(groupId);
              if (newTabGroup) {
                await ActiveWindow.createActiveWindowTabGroup(activeWindow.windowId, newTabGroup);
              }
            }
          }
        }
      }
    });
  } catch (error) {
    throw new Error(myLogger.getPrefixedMessage(`error:${error}`));
  }
}

export async function onTabActivated(tabId: ChromeTabId) {
  const myLogger = logger.createNestedLogger("onTabActivated");
  try {
    await runActiveWindowTabOperation(tabId, async ({ tab }) => {
      myLogger.log(`title: '${tab.title}', groupId: ${tab.groupId}`);
      if (!tab.active) {
        return;
      }

      await ActiveWindow.focusActiveTab(tab.windowId, tab.id, tab.groupId);
    });
  } catch (error) {
    throw new Error(myLogger.getPrefixedMessage(`error:${error}`));
  }
}

export async function onTabUpdated(tab: ChromeTabWithId, changeInfo: chrome.tabs.TabChangeInfo) {
  const myLogger = logger.createNestedLogger("onTabUpdated");
  myLogger.log(`title, changeInfo and id:`, tab.title, changeInfo, tab.id);

  try {
    // If the tab group was changed and the tab is active, focus the tab
    if (changeInfo.groupId !== undefined && tab.active) {
      runActiveWindowTabOperation(tab.id, async ({ tab }) => {
        const isStillTabGroupChanged = changeInfo.groupId === tab.groupId;
        if (isStillTabGroupChanged && tab.active) {
          await ActiveWindow.focusActiveTab(tab.windowId, tab.id, tab.groupId);
          // wait for the potential tab group collapse animation of other groups to finish before doing anything else.
          // Note, this can be changed to run conditionally based on whether the any tab group was actually collapsed.
          // TODO: maybe this should be encapsulated inside of ActiveWindow.focusActiveTab
          await Misc.waitMs(350);
        }
      });
    }

    // If the tab was ungrouped, auto-group it with the other ungrouped highlighted tabs
    if (changeInfo.groupId === chrome.tabGroups.TAB_GROUP_ID_NONE || changeInfo.pinned === false) {
      runActiveWindowTabOperation(tab.id, async ({ tab }) => {
        const isUngroupedAndUnpinned = tab.groupId === chrome.tabGroups.TAB_GROUP_ID_NONE && tab.pinned === false;
        if (isUngroupedAndUnpinned) {
          // TODO: check for `automatically group created tabs` user preference
          await ActiveWindow.autoGroupTabAndHighlightedTabs(tab.windowId, tab.id);
        }
      });
    }

    // If the tab group was changed or the tab title was changed, use the tab title for eligible tab groups
    if (changeInfo.groupId !== undefined || changeInfo.title !== undefined) {
      runActiveWindowTabOperation(tab.id, async ({ tab }) => {
        if (changeInfo.groupId === tab.groupId || changeInfo.title === tab.title) {
          await ActiveWindow.useTabTitleForEligebleTabGroups();
        }
      });
    }
  } catch (error) {
    throw new Error(myLogger.throwPrefixed(`error:${error}`));
  }
}

export async function onTabAttached(tabId: ChromeTabId, attachInfo: chrome.tabs.TabAttachInfo) {
  const myLogger = logger.createNestedLogger("onTabAttached");

  try {
    await runActiveWindowTabOperation(
      tabId,
      async ({ tab }) => {
        await ActiveWindow.autoGroupTabAndHighlightedTabs(tab.windowId, tab.id);
      },
      { windowId: attachInfo.newWindowId, groupId: chrome.tabGroups.TAB_GROUP_ID_NONE, pinned: false }
    );

    await runActiveWindowTabOperation(
      tabId,
      async ({ tab }) => {
        await ActiveWindow.focusActiveTab(tab.windowId, tab.id, tab.groupId);
      },
      { windowId: attachInfo.newWindowId, active: true }
    );
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
