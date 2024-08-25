import ChromeWindowHelper from "../chromeWindowHelper";
import Logger from "../logger";
import Misc from "../misc";
import { ActiveWindow } from "../model";
import * as ActiveWindowMethods from "./ActiveWindowMethods";
import Types from "../types";
import {
  ActiveWindowTabGroup,
  ChromeTabGroupChangeInfo,
  ChromeTabGroupId,
  ChromeTabGroupWithId,
  ChromeTabId,
  ChromeTabWithId,
  ChromeWindowId,
  ChromeWindowWithId,
} from "../types/types";
import Storage from "../storage";

const logger = Logger.createLogger("ActiveWindowEventHandlers", { color: "#4287f5" });

async function runActiveWindowOperation(
  windowId: ChromeWindowId,
  operation: (activeWindow: Types.ActiveWindow, window: ChromeWindowWithId) => Promise<void>
) {
  const { isValid, activeWindow, windowUpToDate } = await validateWindowUpToDateAndActiveWindow(windowId);
  if (!isValid) {
    return;
  }

  await operation(activeWindow, windowUpToDate);
}

async function runActiveWindowTabGroupOperation<T extends Partial<ChromeTabGroupWithId>>(
  tabGroupId: ChromeTabGroupId,
  operation: (context: {
    activeWindow: Types.ActiveWindow;
    tabGroup: ChromeTabGroupWithId;
    matchingTabGroupProperties: { [key in keyof T]: boolean };
  }) => Promise<void>,
  tabGroupPropertiesToMatch?: T | undefined
) {
  const { isValid, activeWindow, tabGroupUpToDate } = await validateTabGroupUpToDateAndActiveWindow(tabGroupId);
  if (!isValid) {
    return;
  }

  const matchingTabGroupProperties = {} as { [key in keyof T]: boolean };
  if (tabGroupPropertiesToMatch) {
    (Object.keys(tabGroupPropertiesToMatch) as (keyof T)[]).forEach((key) => {
      const propertyToMatch = tabGroupPropertiesToMatch[key];
      if (key in tabGroupUpToDate && tabGroupUpToDate[key as keyof ChromeTabGroupWithId] === propertyToMatch) {
        matchingTabGroupProperties[key] = true;
      } else {
        matchingTabGroupProperties[key] = false;
      }
    });
  }

  await operation({ activeWindow, tabGroup: tabGroupUpToDate, matchingTabGroupProperties });
}

async function runActiveWindowTabOperation(
  tabId: ChromeTabId,
  operation: (context: { activeWindow: Types.ActiveWindow; tab: ChromeTabWithId }) => Promise<void>,
  requiredPropertiesToMatch?: Partial<Record<keyof ChromeTabWithId, any>>
) {
  const { isValid, activeWindow, tabUpToDate } = await validateTabUpToDateAndActiveWindow(tabId, requiredPropertiesToMatch);
  if (!isValid) {
    return;
  }

  await operation({ activeWindow, tab: tabUpToDate });
}

async function validateTabUpToDateAndActiveWindow(
  tabId: ChromeTabId,
  requiredPropertiesToMatch?: Partial<Record<keyof ChromeTabWithId, any>>
): Promise<
  | {
      isValid: true;
      activeWindow: Types.ActiveWindow;
      tabUpToDate: ChromeTabWithId;
    }
  | {
      isValid: false;
      activeWindow: undefined;
      tabUpToDate: undefined;
    }
> {
  const tabUpToDate = await ChromeWindowHelper.getIfTabExists(tabId);
  if (!tabUpToDate) {
    return { isValid: false, activeWindow: undefined, tabUpToDate: undefined };
  }

  if (requiredPropertiesToMatch) {
    for (const [key, value] of Object.entries(requiredPropertiesToMatch)) {
      if (tabUpToDate[key as keyof ChromeTabWithId] !== value) {
        return { isValid: false, activeWindow: undefined, tabUpToDate: undefined };
      }
    }
  }

  const activeWindow = await ActiveWindow.get(tabUpToDate.windowId);
  if (!activeWindow) {
    return { isValid: false, activeWindow: undefined, tabUpToDate: undefined };
  }

  return { isValid: true, activeWindow, tabUpToDate };
}

async function validateTabGroupUpToDateAndActiveWindow(groupId: ChromeTabGroupId): Promise<
  | {
      isValid: true;
      activeWindow: Types.ActiveWindow;
      tabGroupUpToDate: ChromeTabGroupWithId;
    }
  | {
      isValid: false;
      activeWindow: undefined;
      tabGroupUpToDate: undefined;
    }
> {
  const tabGroupUpToDate = await ChromeWindowHelper.getIfTabGroupExists(groupId);
  if (!tabGroupUpToDate) {
    return { isValid: false, activeWindow: undefined, tabGroupUpToDate: undefined };
  }

  const activeWindow = await ActiveWindow.get(tabGroupUpToDate.windowId);
  if (!activeWindow) {
    return { isValid: false, activeWindow: undefined, tabGroupUpToDate: undefined };
  }

  return { isValid: true, activeWindow, tabGroupUpToDate };
}

async function validateWindowUpToDateAndActiveWindow(windowId: ChromeWindowId): Promise<
  | {
      isValid: boolean;
      activeWindow: Types.ActiveWindow;
      windowUpToDate: ChromeWindowWithId;
    }
  | {
      isValid: false;
      activeWindow: undefined;
      windowUpToDate: undefined;
    }
> {
  const windowUpToDate = await ChromeWindowHelper.getIfWindowExists(windowId);
  if (!windowUpToDate) {
    return { isValid: false, activeWindow: undefined, windowUpToDate: undefined };
  }

  const activeWindow = await ActiveWindow.get(windowId);
  if (!activeWindow) {
    return { isValid: false, activeWindow: undefined, windowUpToDate: undefined };
  }

  return { isValid: true, activeWindow, windowUpToDate };
}

export async function onWindowCreated(window: ChromeWindowWithId) {
  const myLogger = logger.createNestedLogger("onWindowCreated");
  myLogger.log(`window:`, window);

  try {
    const newActiveWindow = await ActiveWindowMethods.activateWindow(window.id);
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
    await ActiveWindowMethods.deactivateWindow(windowId);
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
    if (windowId !== chrome.windows.WINDOW_ID_NONE) {
      await runActiveWindowOperation(windowId, async (activeWindow) => {
        let keys: Partial<Types.LocalStorageShape> = {};
        if (activeWindow.focusMode) {
          keys = { ...keys, lastSeenFocusModeColors: activeWindow.focusMode.colors };
        }
        await Storage.setItems({ ...keys, lastFocusedWindowHadFocusMode: activeWindow.focusMode !== null });
      });
    }

    // 2
    await ActiveWindowMethods.useTabTitleForEligebleTabGroups();
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

    await ActiveWindowMethods.createActiveWindowTabGroup(activeWindow.windowId, tabGroup);
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
              await ActiveWindowMethods.focusTabGroup(activeWindow.windowId, focusedTabGroupId);
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
            return;
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

      if (
        !tab.pinned &&
        tab.groupId === chrome.tabGroups.TAB_GROUP_ID_NONE &&
        (await Storage.getItems("userPreferences")).userPreferences.alwaysGroupTabs
      ) {
        let existingGroupId: ChromeTabGroupId | undefined;
        if (lastActiveTab && lastActiveTab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE) {
          // 2
          myLogger.log(`adding created tab '${tab.title}' to last active tab group: '${lastActiveTab.title}'`);
          existingGroupId = lastActiveTab.groupId;
        } else {
          // 3
          myLogger.log(`creating new tab group for tab: '${tab.title}'`);
          existingGroupId = undefined;
        }

        const createNewGroup = existingGroupId === undefined;
        // TODO: Re-use logic in ActiveWindowMethods.autoGroupTabAndHighlightedTabs instead of or adjecent to this
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
              await ActiveWindowMethods.createActiveWindowTabGroup(activeWindow.windowId, newTabGroup);
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

      await ActiveWindowMethods.focusActiveTab(tab.windowId, tab.id, tab.groupId);
    });
  } catch (error) {
    throw new Error(myLogger.getPrefixedMessage(`error:${error}`));
  }
}

export async function onTabUpdated(tabId: ChromeTabId, changeInfo: chrome.tabs.TabChangeInfo) {
  const myLogger = logger.createNestedLogger("onTabUpdated");
  try {
    const wasUngroupedOrUnpinned = changeInfo.groupId === chrome.tabGroups.TAB_GROUP_ID_NONE || changeInfo.pinned === false;
    if (wasUngroupedOrUnpinned && (await Storage.getItems("userPreferences")).userPreferences.alwaysGroupTabs) {
      await runActiveWindowTabOperation(tabId, async ({ tab }) => {
        const isUngroupedAndUnpinned = tab.groupId === chrome.tabGroups.TAB_GROUP_ID_NONE && tab.pinned === false;
        if (isUngroupedAndUnpinned) {
          await ActiveWindowMethods.autoGroupTabAndHighlightedTabs(tab.windowId, tab.id);
        }
      });
    } else if (changeInfo.groupId !== undefined) {
      await runActiveWindowTabOperation(tabId, async ({ tab }) => {
        const isStillTabGroupChanged = changeInfo.groupId === tab.groupId;
        if (isStillTabGroupChanged && tab.active) {
          await ActiveWindowMethods.focusActiveTab(tab.windowId, tab.id, tab.groupId);
        }
      });
    }

    if (changeInfo.groupId !== undefined || changeInfo.title !== undefined) {
      await runActiveWindowTabOperation(tabId, async ({ tab }) => {
        if (changeInfo.groupId === tab.groupId || changeInfo.title === tab.title) {
          await ActiveWindowMethods.useTabTitleForEligebleTabGroups();
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
    if ((await Storage.getItems("userPreferences")).userPreferences.alwaysGroupTabs) {
      await runActiveWindowTabOperation(
        tabId,
        async ({ tab }) => {
          if (tab.groupId === chrome.tabGroups.TAB_GROUP_ID_NONE && tab.pinned === false) {
            await ActiveWindowMethods.autoGroupTabAndHighlightedTabs(tab.windowId, tab.id);
          }
        },
        { windowId: attachInfo.newWindowId, groupId: chrome.tabGroups.TAB_GROUP_ID_NONE, pinned: false }
      );
    }

    await runActiveWindowTabOperation(
      tabId,
      async ({ tab }) => {
        if (tab.active) {
          await ActiveWindowMethods.focusActiveTab(tab.windowId, tab.id, tab.groupId);
        }
      },
      { windowId: attachInfo.newWindowId, active: true }
    );
  } catch (error) {
    throw new Error(myLogger.getPrefixedMessage(`error:${error}`));
  }
}

export async function onTabDetached(activeWindow: Types.ActiveWindow, tabId: ChromeTabId) {
  const myLogger = logger.createNestedLogger("onTabDetached");
  try {
    await ActiveWindowMethods.blurTabGroupsIfNoActiveTab(activeWindow.windowId);
  } catch (error) {
    throw new Error(myLogger.getPrefixedMessage(Misc.getErrorMessage(error)));
  }
}

export async function onTabRemoved(activeWindow: Types.ActiveWindow, tabId: ChromeTabId, removeInfo: chrome.tabs.TabRemoveInfo) {
  const myLogger = logger.createNestedLogger("onTabRemoved");
  try {
    await ActiveWindowMethods.blurTabGroupsIfNoActiveTab(activeWindow.windowId);
  } catch (error) {
    throw new Error(myLogger.getPrefixedMessage(Misc.getErrorMessage(error)));
  }
}

export async function onMouseInPageStatusChanged(tabId: ChromeTabId, status: Types.MouseInPageStatus) {
  const myLogger = logger.createNestedLogger("onMouseInPageStatusChanged");
  myLogger.log(`tabId: ${tabId} status: ${status}`);

  switch (status) {
    case "entered":
      await ActiveWindowMethods.useTabTitleForEligebleTabGroups();
      break;
    case "focused":
      await runActiveWindowTabOperation(tabId, async ({ tab }) => {
        if (tab.active && !tab.pinned) {
          await ActiveWindowMethods.repositionTab(tab.windowId, tab.id);
        }
      });
      break;
  }
}

export async function onEnabledCollapseUnfocusedTabGroups() {
  const activeWindows = await ActiveWindow.getAll();
  const activeTabs = (await chrome.tabs.query({ active: true })) as ChromeTabWithId[];
  const activeTabsByWindowId = activeTabs.reduce((acc, activeTab) => {
    acc[activeTab.windowId] = activeTab;
    return acc;
  }, {} as { [windowId: ChromeWindowId]: ChromeTabWithId | undefined });

  await Promise.all(
    activeWindows.map(async (activeWindow) => {
      const activeTab = activeTabsByWindowId[activeWindow.windowId];
      // This will effectively collapse all unfocused tab groups
      await ActiveWindowMethods.focusTabGroup(activeWindow.windowId, activeTab?.groupId ?? chrome.tabGroups.TAB_GROUP_ID_NONE);
    })
  );
}

export async function onEnabledAlwaysGroupTabs() {
  const activeWindows = await ActiveWindow.getAll();
  await Promise.all(
    activeWindows.map(async (activeWindow) => {
      await ActiveWindowMethods.groupUnpinnedAndUngroupedTabs(activeWindow.windowId);
    })
  );
}

export async function onChangeKeepTabGroupOpen(windowId: ChromeWindowId, tabGroupId: ChromeTabGroupId, enabled: boolean) {
  const updatedProps: Partial<ActiveWindowTabGroup> = { keepOpen: enabled };
  if (enabled) {
    const tabGroup = await chrome.tabGroups.get(tabGroupId);
    if (tabGroup.collapsed) {
      const tabGroupUpToDate = await ChromeWindowHelper.updateTabGroupWithRetryHandler(tabGroupId, { collapsed: false });
      if (tabGroupUpToDate) {
        updatedProps.collapsed = tabGroupUpToDate.collapsed;
      }
    }
  }
  return await ActiveWindow.updateActiveWindowTabGroup(windowId, tabGroupId, updatedProps);
}

export async function onChangeFocusMode(windowId: ChromeWindowId, enabled: boolean) {
  const myLogger = logger.createNestedLogger("onChangeFocusMode");
  try {
    await ActiveWindow.getOrThrow(windowId);
    if (enabled) {
      return await ActiveWindowMethods.enableFocusMode(windowId);
    } else {
      return await ActiveWindowMethods.disableFocusMode(windowId);
    }
  } catch (error) {
    throw new Error(myLogger.getPrefixedMessage(Misc.getErrorMessage(error)));
  }
}

export async function onChangeActivateCurrentWindow(windowId: ChromeWindowId, enabled: boolean) {
  const myLogger = logger.createNestedLogger("onChangeActivateCurrentWindow");
  try {
    const activeWindow = await ActiveWindow.get(windowId);
    if (enabled) {
      if (activeWindow) {
        throw new Error(`Current window with id ${windowId} is already active`);
      }
      return await ActiveWindowMethods.activateWindow(windowId);
    } else {
      if (!activeWindow) {
        throw new Error(`Current window with id ${windowId} is not active`);
      }
      return await ActiveWindowMethods.deactivateWindow(windowId);
    }
  } catch (error) {
    throw new Error(myLogger.getPrefixedMessage(Misc.getErrorMessage(error)));
  }
}
