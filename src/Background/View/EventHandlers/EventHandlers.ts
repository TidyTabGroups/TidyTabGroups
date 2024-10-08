import ChromeWindowMethods from "../../../Shared/ChromeWindowMethods";
import Logger from "../../../Shared/Logger";
import Misc from "../../../Shared/Misc";
import * as Model from "../../Model/Model";
import * as ViewModel from "../../ViewModel/ViewModel";
import Types from "../../../Shared/Types";
import {
  ChromeTabGroupChangeInfo,
  ChromeTabGroupId,
  ChromeTabId,
  ChromeTabWithId,
  ChromeWindowId,
  ChromeWindowWithId,
} from "../../../Shared/Types/Types";
import Storage from "../../../Shared/Storage";
import * as ActiveWindowOperationRunner from "./OperationRunner";

const logger = Logger.createLogger("Background::View::EventHandlers", { color: "#4287f5" });

export async function onWindowCreated(window: ChromeWindowWithId) {
  const myLogger = logger.createNestedLogger("onWindowCreated");
  myLogger.log(`window:`, window);

  try {
    const newActiveWindow = await ViewModel.activateWindow(window.id);
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
    await ViewModel.deactivateWindow(windowId);
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
      await ActiveWindowOperationRunner.runActiveWindowOperation(windowId, async (activeWindow) => {
        let keys: Partial<Types.LocalStorageShape> = {};
        if (activeWindow.focusMode) {
          keys = { ...keys, lastSeenFocusModeColors: activeWindow.focusMode.colors };
        }
        await Storage.setItems({ ...keys, lastFocusedWindowHadFocusMode: activeWindow.focusMode !== null });
      });
    }

    // 2
    await ViewModel.useTabTitleForEligebleTabGroups();
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

    await ViewModel.createActiveWindowTabGroup(activeWindow.windowId, tabGroup);
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
    await Model.removeActiveWindowTabGroup(activeWindow.windowId, tabGroup.id);
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
      await ActiveWindowOperationRunner.runActiveWindowTabGroupOperation(
        tabGroup.id,
        async ({ tabGroup }) => {
          const prevActiveWindowTabGroupColor = activeWindowTabGroup.color;
          await Model.updateActiveWindowTabGroup(activeWindow.windowId, tabGroup.id, { color: changeInfo.color });

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

            await Model.updateActiveWindowTabGroup(tabGroup.windowId, tabGroup.id, { color: tabGroupUpToDate.color });
          } else {
            await ViewModel.updateFocusModeColorForTabGroupWithColor(activeWindow.windowId, tabGroup.id, changeInfo.color!);
          }
        },
        { color: changeInfo.color }
      );
    }

    if (wasExpanded) {
      await ActiveWindowOperationRunner.runActiveWindowTabGroupOperation(
        tabGroup.id,
        async () => {
          await Model.updateActiveWindowTabGroup(activeWindow.windowId, tabGroup.id, { collapsed: false });
          await ViewModel.activateLastActiveTabInGroup(activeWindow.windowId, tabGroup.id);
        },
        { collapsed: false }
      );
    }

    if (wasCollapsed) {
      await ActiveWindowOperationRunner.runActiveWindowTabGroupOperation(
        tabGroup.id,
        () => Model.updateActiveWindowTabGroup(activeWindow.windowId, tabGroup.id, { collapsed: true }),
        { collapsed: true }
      );
    }

    // 6
    if (wasTitleUpdated) {
      await ActiveWindowOperationRunner.runActiveWindowTabGroupOperation(
        tabGroup.id,
        ({ tabGroup }) =>
          Model.updateActiveWindowTabGroup(activeWindow.windowId, tabGroup.id, { title: tabGroup.title, useTabTitle: false }),
        { title: changeInfo.title }
      );
    }
  } catch (error) {
    throw new Error(myLogger.getPrefixedMessage(`error:${error}`));
  }
}

export async function onTabCreated(tabId: ChromeTabId) {
  const myLogger = logger.createNestedLogger("onTabCreated");
  try {
    await ActiveWindowOperationRunner.runActiveWindowTabOperation(tabId, async ({ activeWindow, tab }) => {
      if (tab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE) {
        // We create the active window tab group now because subsequent events that need it (e.g. onTabActivated)
        //   could be called before the onTabGroupCreated event
        await ViewModel.createActiveWindowTabGroupIfNotExists(activeWindow.windowId, tab.groupId);
        return;
      }

      if (!tab.pinned && (await Storage.getItems("userPreferences")).userPreferences.alwaysGroupTabs) {
        /* Auto-group tab */

        // Get the previously active tab
        const tabs = (await chrome.tabs.query({ windowId: tab.windowId })) as ChromeTabWithId[];
        const tabsOrderedByLastAccessed = await ChromeWindowMethods.getTabsOrderedByLastAccessed(tabs);
        let prevActiveTab: ChromeTabWithId | undefined;
        // the last active tab could be this tab if it is activated, in that case, get the previous last active tab
        if (tabsOrderedByLastAccessed[0]?.id === tab.id) {
          prevActiveTab = tabsOrderedByLastAccessed[1] as ChromeTabWithId | undefined;
        } else {
          prevActiveTab = tabsOrderedByLastAccessed[0] as ChromeTabWithId | undefined;
        }

        let existingGroupId: ChromeTabGroupId | undefined;
        if (prevActiveTab && prevActiveTab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE) {
          // If the previous active tab was in a group, add the tab to the last active tab group
          myLogger.log(`adding created tab '${tab.title}' to last active tab group: '${prevActiveTab.title}'`);
          existingGroupId = prevActiveTab.groupId;
        } else {
          // Otherwise, create a new tab group for it
          myLogger.log(`creating new tab group for tab: '${tab.title}'`);
          existingGroupId = undefined;
        }

        const createNewGroup = existingGroupId === undefined;
        // TODO: Re-use logic in ViewModel.autoGroupTabAndHighlightedTabs instead of or adjecent to this
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
              await ViewModel.createActiveWindowTabGroup(activeWindow.windowId, newTabGroup);
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
    await ActiveWindowOperationRunner.runActiveWindowTabOperation(
      tabId,
      async ({ tab }) => {
        myLogger.log(`title: '${tab.title}', groupId: ${tab.groupId}`);
        await ViewModel.focusActiveTab(tab.windowId, tab.id, tab.groupId);
      },
      { active: true }
    );

    await ActiveWindowOperationRunner.runActiveWindowTabOperation(
      tabId,
      async ({ tab }) => {
        if (tab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE) {
          await Model.updateActiveWindowTabGroup(tab.windowId, tab.groupId, { lastActiveTabId: tab.id });
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
      await ActiveWindowOperationRunner.runActiveWindowTabOperation(
        tabId,
        async ({ tab }) => {
          didAutoGroup = true;
          await ViewModel.autoGroupTabAndHighlightedTabs(tab.windowId, tab.id);
        },
        { groupId: chrome.tabGroups.TAB_GROUP_ID_NONE, pinned: false }
      );
    }

    if (changeInfo.groupId !== undefined && !didAutoGroup /* If the tab was auto-grouped, then it was already focused */) {
      await ActiveWindowOperationRunner.runActiveWindowTabOperation(
        tabId,
        async ({ tab }) => {
          await ViewModel.focusActiveTab(tab.windowId, tab.id, tab.groupId);
        },
        { groupId: changeInfo.groupId, active: true }
      );
    }

    if (changeInfo.groupId !== undefined) {
      await ViewModel.updateLastActiveTabIdForTabGroupWithTabId(tabId);
    }

    if (changeInfo.groupId !== undefined || changeInfo.title !== undefined) {
      await ActiveWindowOperationRunner.runActiveWindowTabOperation(tabId, () => ViewModel.useTabTitleForEligebleTabGroups(), {
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
      await ActiveWindowOperationRunner.runActiveWindowTabOperation(
        tabId,
        async ({ tab }) => {
          if (tab.groupId === chrome.tabGroups.TAB_GROUP_ID_NONE && tab.pinned === false) {
            await ViewModel.autoGroupTabAndHighlightedTabs(tab.windowId, tab.id);
          }
        },
        { windowId: attachInfo.newWindowId, groupId: chrome.tabGroups.TAB_GROUP_ID_NONE, pinned: false }
      );
    }

    await ActiveWindowOperationRunner.runActiveWindowTabOperation(
      tabId,
      async ({ tab }) => {
        if (tab.active) {
          await ViewModel.focusActiveTab(tab.windowId, tab.id, tab.groupId);
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
    await ViewModel.blurTabGroupsIfNoActiveTab(activeWindow.windowId);
  } catch (error) {
    throw new Error(myLogger.getPrefixedMessage(Misc.getErrorMessage(error)));
  }
}

export async function onTabRemoved(activeWindow: Types.ActiveWindow, tabId: ChromeTabId, removeInfo: chrome.tabs.TabRemoveInfo) {
  const myLogger = logger.createNestedLogger("onTabRemoved");
  try {
    await ViewModel.blurTabGroupsIfNoActiveTab(activeWindow.windowId);
  } catch (error) {
    throw new Error(myLogger.getPrefixedMessage(Misc.getErrorMessage(error)));
  }
}

export async function onMouseInPageStatusChanged(tabId: ChromeTabId, status: Types.MouseInPageStatus) {
  const myLogger = logger.createNestedLogger("onMouseInPageStatusChanged");
  myLogger.log(`tabId: ${tabId} status: ${status}`);

  switch (status) {
    case "entered":
      await ViewModel.useTabTitleForEligebleTabGroups();
      break;
    case "focused":
      await ActiveWindowOperationRunner.runActiveWindowTabOperation(tabId, async ({ tab }) => {
        if (tab.active && !tab.pinned) {
          await ViewModel.repositionTab(tab.windowId, tab.id);
        }
      });
      break;
  }
}

export async function onEnabledCollapseUnfocusedTabGroups() {
  const activeWindows = await Model.getAll();
  const activeTabs = (await chrome.tabs.query({ active: true })) as ChromeTabWithId[];
  const activeTabsByWindowId = activeTabs.reduce((acc, activeTab) => {
    acc[activeTab.windowId] = activeTab;
    return acc;
  }, {} as { [windowId: ChromeWindowId]: ChromeTabWithId | undefined });

  await Promise.all(
    activeWindows.map(async (activeWindow) => {
      const activeTab = activeTabsByWindowId[activeWindow.windowId];
      // This will effectively collapse all unfocused tab groups
      await ViewModel.focusTabGroup(activeWindow.windowId, activeTab?.groupId ?? chrome.tabGroups.TAB_GROUP_ID_NONE);
    })
  );
}

export async function onEnabledAlwaysGroupTabs() {
  const activeWindows = await Model.getAll();
  await Promise.all(
    activeWindows.map(async (activeWindow) => {
      await ViewModel.groupUnpinnedAndUngroupedTabs(activeWindow.windowId);
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
  return await Model.updateActiveWindowTabGroup(windowId, tabGroupId, updatedProps);
}

export async function onChangeFocusMode(windowId: ChromeWindowId, enabled: boolean) {
  const myLogger = logger.createNestedLogger("onChangeFocusMode");
  try {
    await Model.getOrThrow(windowId);
    if (enabled) {
      return await ViewModel.enableFocusMode(windowId);
    } else {
      return await ViewModel.disableFocusMode(windowId);
    }
  } catch (error) {
    throw new Error(myLogger.getPrefixedMessage(Misc.getErrorMessage(error)));
  }
}

export async function onChangeActivateCurrentWindow(windowId: ChromeWindowId, enabled: boolean) {
  const myLogger = logger.createNestedLogger("onChangeActivateCurrentWindow");
  try {
    const activeWindow = await Model.get(windowId);
    if (enabled) {
      if (activeWindow) {
        throw new Error(`Current window with id ${windowId} is already active`);
      }
      return await ViewModel.activateWindow(windowId);
    } else {
      if (!activeWindow) {
        throw new Error(`Current window with id ${windowId} is not active`);
      }
      return await ViewModel.deactivateWindow(windowId);
    }
  } catch (error) {
    throw new Error(myLogger.getPrefixedMessage(Misc.getErrorMessage(error)));
  }
}

export async function onChangeHighlightPrevActiveTabGroup(enabled: boolean) {
  const myLogger = logger.createNestedLogger("onChangeHighlightPrevActiveTabGroup");
  try {
    const activeWindows = await Model.getAll();
    await Promise.all(
      activeWindows.map(async (activeWindow) => {
        const [activeTab] = (await chrome.tabs.query({ active: true, windowId: activeWindow.windowId })) as (ChromeTabWithId | undefined)[];
        return await ViewModel.focusTabGroup(activeWindow.windowId, activeTab?.groupId ?? chrome.tabGroups.TAB_GROUP_ID_NONE);
      })
    );
  } catch (error) {
    throw new Error(myLogger.getPrefixedMessage(Misc.getErrorMessage(error)));
  }
}
