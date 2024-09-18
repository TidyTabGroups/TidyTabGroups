import ChromeWindowMethods from "../../Shared/ChromeWindowMethods";
import Logger from "../../Shared/Logger";
import Misc from "../../Shared/Misc";
import * as ActiveWindowModel from "./ActiveWindowModel";
import * as ActiveWindowMethods from "./ActiveWindowMethods";
import Types from "../../Shared/Types";
import {
  ActiveWindowTabGroup,
  ChromeTabGroupChangeInfo,
  ChromeTabGroupId,
  ChromeTabGroupWithId,
  ChromeTabId,
  ChromeTabWithId,
  ChromeWindowId,
  ChromeWindowWithId,
} from "../../Shared/Types/Types";
import Storage from "../../Shared/Storage";

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
  operation: (context: { activeWindow: Types.ActiveWindow; tabGroup: ChromeTabGroupWithId }) => Promise<void>,
  requiredPropertiesToMatch?: Partial<Record<keyof ChromeTabGroupWithId, any>>
) {
  const { isValid, activeWindow, tabGroupUpToDate } = await validateTabGroupUpToDateAndActiveWindow(tabGroupId, requiredPropertiesToMatch);
  if (!isValid) {
    return;
  }

  await operation({ activeWindow, tabGroup: tabGroupUpToDate });
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
  const tabUpToDate = await ChromeWindowMethods.getIfTabExists(tabId);
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

  const activeWindow = await ActiveWindowModel.get(tabUpToDate.windowId);
  if (!activeWindow) {
    return { isValid: false, activeWindow: undefined, tabUpToDate: undefined };
  }

  return { isValid: true, activeWindow, tabUpToDate };
}

async function validateTabGroupUpToDateAndActiveWindow(
  groupId: ChromeTabGroupId,
  requiredPropertiesToMatch?: Partial<Record<keyof ChromeTabGroupWithId, any>>
): Promise<
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
  const tabGroupUpToDate = await ChromeWindowMethods.getIfTabGroupExists(groupId);
  if (!tabGroupUpToDate) {
    return { isValid: false, activeWindow: undefined, tabGroupUpToDate: undefined };
  }

  if (requiredPropertiesToMatch) {
    for (const [key, value] of Object.entries(requiredPropertiesToMatch)) {
      if (tabGroupUpToDate[key as keyof ChromeTabGroupWithId] !== value) {
        return { isValid: false, activeWindow: undefined, tabGroupUpToDate: undefined };
      }
    }
  }

  const activeWindow = await ActiveWindowModel.get(tabGroupUpToDate.windowId);
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
  const windowUpToDate = await ChromeWindowMethods.getIfWindowExists(windowId);
  if (!windowUpToDate) {
    return { isValid: false, activeWindow: undefined, windowUpToDate: undefined };
  }

  const activeWindow = await ActiveWindowModel.get(windowId);
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
    await ActiveWindowModel.update(activeWindow.windowId, {
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
  try {
    const wasColorUpdated = changeInfo.color !== undefined;
    const wasExpanded = changeInfo.collapsed === false;
    const wasCollapsed = changeInfo.collapsed === true;
    const wasTitleUpdated = changeInfo.title !== undefined;

    myLogger.log(`id: ${tabGroup.id}, title: ${tabGroup.title}`);

    if (wasColorUpdated) {
      await runActiveWindowTabGroupOperation(
        tabGroup.id,
        async ({ tabGroup }) => {
          const prevActiveWindowTabGroupColor = activeWindowTabGroup.color;
          await ActiveWindowModel.updateActiveWindowTabGroup(activeWindow.windowId, tabGroup.id, { color: changeInfo.color });

          if (!activeWindow.focusMode) {
            return;
          }

          if (wasTitleUpdated) {
            // FIXME: this is a workaround for a chromium bug where updating the title of a newly created tab group
            // causes the color to be reset back to its original color. We need to reset back to it's previous color.
            // Remove once the Chromium bug is fixed: https://issues.chromium.org/issues/334965868
            const tabGroupUpToDate = await ChromeWindowMethods.updateTabGroupWithRetryHandler(tabGroup.id, {
              color: prevActiveWindowTabGroupColor,
            });
            if (!tabGroupUpToDate) {
              return;
            }

            await ActiveWindowModel.updateActiveWindowTabGroup(tabGroup.windowId, tabGroup.id, { color: tabGroupUpToDate.color });
          } else {
            await ActiveWindowMethods.updateFocusModeColorForTabGroupWithColor(activeWindow.windowId, tabGroup.id, changeInfo.color!);
          }
        },
        { color: changeInfo.color }
      );
    }

    if (wasExpanded) {
      await runActiveWindowTabGroupOperation(
        tabGroup.id,
        async () => {
          await ActiveWindowModel.updateActiveWindowTabGroup(activeWindow.windowId, tabGroup.id, { collapsed: false });
          await ActiveWindowMethods.activateLastActiveTabInGroup(activeWindow.windowId, tabGroup.id);
        },
        { collapsed: false }
      );
    }

    if (wasCollapsed) {
      await runActiveWindowTabGroupOperation(
        tabGroup.id,
        () => ActiveWindowModel.updateActiveWindowTabGroup(activeWindow.windowId, tabGroup.id, { collapsed: true }),
        { collapsed: true }
      );
    }

    // 6
    if (wasTitleUpdated) {
      await runActiveWindowTabGroupOperation(
        tabGroup.id,
        ({ tabGroup }) =>
          ActiveWindowModel.updateActiveWindowTabGroup(activeWindow.windowId, tabGroup.id, { title: tabGroup.title, useTabTitle: false }),
        { title: changeInfo.title }
      );
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
      if (
        !tab.pinned &&
        tab.groupId === chrome.tabGroups.TAB_GROUP_ID_NONE &&
        (await Storage.getItems("userPreferences")).userPreferences.alwaysGroupTabs
      ) {
        // 1
        const tabs = (await chrome.tabs.query({ windowId: tab.windowId })) as ChromeTabWithId[];
        const tabsOrderedByLastAccessed = await ChromeWindowMethods.getTabsOrderedByLastAccessed(tabs);
        let lastActiveTab: ChromeTabWithId | undefined;
        // the last active tab could be this tab if it is activated, in that case, get the previous last active tab
        if (tabsOrderedByLastAccessed[0]?.id === tab.id) {
          lastActiveTab = tabsOrderedByLastAccessed[1] as ChromeTabWithId | undefined;
        } else {
          lastActiveTab = tabsOrderedByLastAccessed[0] as ChromeTabWithId | undefined;
        }

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
        const groupId = await ChromeWindowMethods.groupTabsWithRetryHandler({
          createProperties: createNewGroup ? { windowId: tab.windowId } : undefined,
          groupId: createNewGroup ? undefined : existingGroupId,
          tabIds: tab.id,
        });

        if (groupId !== undefined) {
          tab.groupId = groupId;

          if (createNewGroup) {
            const newTabGroup = await ChromeWindowMethods.getIfTabGroupExists(groupId);
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
    await runActiveWindowTabOperation(
      tabId,
      async ({ tab }) => {
        myLogger.log(`title: '${tab.title}', groupId: ${tab.groupId}`);
        await ActiveWindowMethods.focusActiveTab(tab.windowId, tab.id, tab.groupId);
      },
      { active: true }
    );

    await runActiveWindowTabOperation(
      tabId,
      async ({ tab }) => {
        if (tab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE) {
          await ActiveWindowModel.updateActiveWindowTabGroup(tab.windowId, tab.groupId, { lastActiveTabId: tab.id });
        }
      },
      { active: true }
    );
  } catch (error) {
    throw new Error(myLogger.getPrefixedMessage(`error:${error}`));
  }
}

export async function onTabUpdated(tabId: ChromeTabId, changeInfo: chrome.tabs.TabChangeInfo) {
  const myLogger = logger.createNestedLogger("onTabUpdated");
  try {
    let didAutoGroup = false;
    const wasUngroupedOrUnpinned = changeInfo.groupId === chrome.tabGroups.TAB_GROUP_ID_NONE || changeInfo.pinned === false;
    if (wasUngroupedOrUnpinned && (await Storage.getItems("userPreferences")).userPreferences.alwaysGroupTabs) {
      await runActiveWindowTabOperation(
        tabId,
        async ({ tab }) => {
          didAutoGroup = true;
          await ActiveWindowMethods.autoGroupTabAndHighlightedTabs(tab.windowId, tab.id);
        },
        { groupId: chrome.tabGroups.TAB_GROUP_ID_NONE, pinned: false }
      );
    }

    if (changeInfo.groupId !== undefined && !didAutoGroup /* If the tab was auto-grouped, then it was already focused */) {
      await runActiveWindowTabOperation(
        tabId,
        async ({ tab }) => {
          await ActiveWindowMethods.focusActiveTab(tab.windowId, tab.id, tab.groupId);
        },
        { groupId: changeInfo.groupId, active: true }
      );
    }

    if (changeInfo.groupId !== undefined) {
      await ActiveWindowMethods.updateLastActiveTabIdForTabGroupWithTabId(tabId);
    }

    if (changeInfo.groupId !== undefined || changeInfo.title !== undefined) {
      await runActiveWindowTabOperation(tabId, () => ActiveWindowMethods.useTabTitleForEligebleTabGroups(), {
        groupId: changeInfo.groupId,
        title: changeInfo.title,
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
  const activeWindows = await ActiveWindowModel.getAll();
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
  const activeWindows = await ActiveWindowModel.getAll();
  await Promise.all(
    activeWindows.map(async (activeWindow) => {
      await ActiveWindowMethods.groupUnpinnedAndUngroupedTabs(activeWindow.windowId);
    })
  );
}

export async function onChangeKeepTabGroupOpen(windowId: ChromeWindowId, tabGroupId: ChromeTabGroupId, enabled: boolean) {
  const updatedProps: { keepOpen: boolean; collapsed?: boolean } = { keepOpen: enabled };
  if (enabled) {
    const tabGroup = await chrome.tabGroups.get(tabGroupId);
    if (tabGroup.collapsed) {
      const tabGroupUpToDate = await ChromeWindowMethods.updateTabGroupWithRetryHandler(tabGroupId, { collapsed: false });
      if (tabGroupUpToDate) {
        updatedProps.collapsed = tabGroupUpToDate.collapsed;
      }
    }
  }
  return await ActiveWindowModel.updateActiveWindowTabGroup(windowId, tabGroupId, updatedProps);
}

export async function onChangeFocusMode(windowId: ChromeWindowId, enabled: boolean) {
  const myLogger = logger.createNestedLogger("onChangeFocusMode");
  try {
    await ActiveWindowModel.getOrThrow(windowId);
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
    const activeWindow = await ActiveWindowModel.get(windowId);
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

export async function onChangeHighlightPrevActiveTabGroup(enabled: boolean) {
  const myLogger = logger.createNestedLogger("onChangeHighlightPrevActiveTabGroup");
  try {
    const activeWindows = await ActiveWindowModel.getAll();
    await Promise.all(
      activeWindows.map(async (activeWindow) => {
        const [activeTab] = (await chrome.tabs.query({ active: true, windowId: activeWindow.windowId })) as (ChromeTabWithId | undefined)[];
        return await ActiveWindowMethods.focusTabGroup(activeWindow.windowId, activeTab?.groupId ?? chrome.tabGroups.TAB_GROUP_ID_NONE);
      })
    );
  } catch (error) {
    throw new Error(myLogger.getPrefixedMessage(Misc.getErrorMessage(error)));
  }
}
