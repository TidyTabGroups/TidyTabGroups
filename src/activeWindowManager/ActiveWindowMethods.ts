import ChromeWindowHelper from "../chromeWindowHelper";
import Logger from "../logger";
import Misc from "../misc";
import { ActiveWindow } from "../model";
import MouseInPageTracker from "../mouseInPageTracker";
import Types from "../types";
import {
  ChromeWindowId,
  ChromeWindowWithId,
  ActiveWindowFocusModeColors,
  ChromeTabGroupId,
  ChromeTabWithId,
  ChromeTabGroupWithId,
  ChromeTabId,
} from "../types/types";
import Storage from "../storage";

const logger = Logger.createLogger("ActiveWindowMethods");

let windowsBeingActivated: ChromeWindowId[] = [];
let activatingAllWindows = false;
let reactivatingAllWindows = false;

export function isActivatingAllWindows() {
  return activatingAllWindows;
}

export function isReactivatingAllWindows() {
  return reactivatingAllWindows;
}

export function isActivatingOrReactivatingAllWindows() {
  return isActivatingAllWindows() || isReactivatingAllWindows();
}

export function isActivatingWindow(windowId: ChromeWindowId) {
  return isActivatingAllWindows() || windowIsBeingActivated(windowId);
}

export function isActivatingAnyWindow() {
  return isActivatingAllWindows() || windowsBeingActivated.length > 0;
}

export function windowIsBeingActivated(windowId: ChromeWindowId) {
  return windowsBeingActivated.includes(windowId);
}

export function getWindowsBeingActivated() {
  return windowsBeingActivated;
}

export async function reactivateAllWindows() {
  if (isReactivatingAllWindows() || isActivatingAnyWindow()) {
    throw new Error("reactivateAllWindows::already re-activating all windows, or another window is being activated");
  }

  try {
    reactivatingAllWindows = true;

    const [windows, previousActiveWindows] = await Promise.all([chrome.windows.getAll() as Promise<ChromeWindowWithId[]>, ActiveWindow.getAll()]);
    const windowIds = windows.map((window) => window.id);

    await ActiveWindow.clear();

    await Promise.all(
      windowIds.map(async (windowId) => {
        const previousActiveWindow = previousActiveWindows.find((previousActiveWindow) => previousActiveWindow.windowId === windowId);
        await activateWindowInternal(windowId, previousActiveWindow?.focusMode?.colors);
      })
    );
  } catch (error) {
    throw new Error(`reactivateAllWindows::${error}`);
  } finally {
    reactivatingAllWindows = false;
  }
}

export async function activateAllWindows() {
  if (isActivatingAnyWindow()) {
    throw new Error("activateAllWindows::a window is already being activated");
  }

  activatingAllWindows = true;

  try {
    const windows = (await chrome.windows.getAll()) as ChromeWindowWithId[];
    await Promise.all(windows.map((window) => activateWindowInternal(window.id)));
  } catch (error) {
    throw new Error(`activateAllWindows::${error}`);
  } finally {
    activatingAllWindows = false;
  }
}

async function activateWindowInternal(windowId: ChromeWindowId, focusModeColors?: ActiveWindowFocusModeColors) {
  const myLogger = logger.createNestedLogger("activateWindowInternal");
  try {
    const window = (await chrome.windows.get(windowId)) as ChromeWindowWithId;
    if (!window) {
      throw new Error(`activateWindow::window with id ${window} not found`);
    }

    if (window.type !== "normal") {
      throw new Error(`activateWindow::window with id ${window} is not a normal window`);
    }

    let newFocusModeColors: ActiveWindowFocusModeColors | null = null;
    if (focusModeColors) {
      newFocusModeColors = focusModeColors;
    } else {
      const { userPreferences, lastSeenFocusModeColors } = await Storage.getItems(["userPreferences", "lastSeenFocusModeColors"]);
      newFocusModeColors = userPreferences.enableFocusModeForNewWindows ? lastSeenFocusModeColors : null;
    }

    if (window.focused && newFocusModeColors) {
      await Storage.setItems({ lastSeenFocusModeColors: newFocusModeColors, lastFocusedWindowHadFocusMode: true });
    }

    let useTabTitleForGroupId: ChromeTabGroupId | null = null;
    if ((await Storage.getItems("userPreferences")).userPreferences.alwaysGroupTabs) {
      const newTabGroupId = await ChromeWindowHelper.groupUnpinnedAndUngroupedTabsWithRetryHandler(windowId);
      if (newTabGroupId) {
        const [newTabGroup, tabsInGroup] = await Promise.all([
          chrome.tabGroups.get(newTabGroupId),
          chrome.tabs.query({ groupId: newTabGroupId }) as Promise<ChromeTabWithId[]>,
        ]);

        if (Misc.isTabGroupTitleEmpty(newTabGroup.title)) {
          const tabGroupUpToDate = await ChromeWindowHelper.updateTabGroupWithRetryHandler(newTabGroupId, {
            title: ChromeWindowHelper.getTabTitleForUseTabTitle(tabsInGroup) ?? `${tabsInGroup.length} tabs`,
          });

          if (tabGroupUpToDate) {
            // TODO: check for `use tab title for blank tab groups` user preference
            useTabTitleForGroupId = newTabGroupId;
          }
        }
      }
    }

    const [activeTab] = (await chrome.tabs.query({ windowId, active: true })) as (ChromeTabWithId | undefined)[];
    await ChromeWindowHelper.focusTabGroupWithRetryHandler(
      activeTab ? activeTab.groupId : chrome.tabGroups.TAB_GROUP_ID_NONE,
      windowId,
      {
        collapseUnfocusedTabGroups: (await Storage.getItems("userPreferences")).userPreferences.collapseUnfocusedTabGroups,
        highlightColors: newFocusModeColors ?? undefined,
      },
      true
    );

    const tabGroups = (await chrome.tabGroups.query({ windowId })) as ChromeTabGroupWithId[];
    let newFocusMode = newFocusModeColors
      ? {
          colors: newFocusModeColors,
          savedTabGroupColors: tabGroups.map((tabGroup) => ({ tabGroupId: tabGroup.id, color: tabGroup.color })),
        }
      : null;
    const newActiveWindow = {
      windowId,
      focusMode: newFocusMode,
      tabGroups: tabGroups.map((tabGroup) => {
        return ActiveWindow.chromeTabGroupToActiveWindowTabGroup(tabGroup, { useTabTitle: useTabTitleForGroupId === tabGroup.id });
      }),
    } as Types.ActiveWindow;

    await ActiveWindow.add(newActiveWindow);
    return newActiveWindow;
  } catch (error) {
    throw new Error(myLogger.getPrefixedMessage(Misc.getErrorMessage(error)));
  }
}

export async function activateWindow(windowId: ChromeWindowId) {
  if (isActivatingWindow(windowId)) {
    throw new Error(`activateWindow::windowId ${windowId} is already being activated`);
  }

  windowsBeingActivated.push(windowId);

  try {
    return await activateWindowInternal(windowId);
  } catch (error) {
    throw new Error(`activateWindow::${error}`);
  } finally {
    windowsBeingActivated = windowsBeingActivated.filter((id) => id !== windowId);
  }
}

export async function deactivateWindow(windowId: ChromeWindowId) {
  if (isActivatingWindow(windowId)) {
    throw new Error(`deactivateWindow::windowId ${windowId} is being activated`);
  }
  const activeWindow = await ActiveWindow.get(windowId);
  if (!activeWindow) {
    throw new Error(`deactivateWindow::windowId ${windowId} not found`);
  }

  await ActiveWindow.remove(windowId);
}

export async function repositionTab(windowId: ChromeWindowId, tabId: ChromeTabId) {
  const activeWindow = await ActiveWindow.getOrThrow(windowId);

  const tabs = (await chrome.tabs.query({ windowId })) as ChromeTabWithId[];
  const tab = tabs.find((tab) => tab.id === tabId);
  if (!tab) {
    throw new Error(`repositionTab::tabId ${tabId} not found in windowId ${windowId}`);
  }

  const getUserPreferences = Misc.lazyCall(async () => {
    return (await Storage.getItems("userPreferences")).userPreferences;
  });

  if (!tab.pinned) {
    // if the tab is in a tab group, lastRelativeTabIndex will be the last tab in the group, otherwise it will be the last tab in the window
    let lastRelativeTabIndex = tabs[tabs.length - 1].index;

    // reposition the tab's group to the end
    if (tab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE) {
      const tabsInGroup = tabs.filter((otherTab) => otherTab.groupId === tab.groupId);
      const lastTabInGroup = tabsInGroup[tabsInGroup.length - 1];
      if (lastTabInGroup.index < tabs[tabs.length - 1].index && (await getUserPreferences()).repositionTabGroups) {
        await ChromeWindowHelper.moveTabGroupWithRetryHandler(tab.groupId, { index: -1 });
      } else {
        lastRelativeTabIndex = lastTabInGroup.index;
      }
    }

    // reposition the tab to the end
    // if the tab opened any un-accessed tabs that are positioned after it, then dont move it
    const hasOpenedUnaccessedTabs = tabs.some((t) => t.openerTabId === tab.id && t.lastAccessed === undefined && t.index > tab.index);
    if (tab.index < lastRelativeTabIndex && !hasOpenedUnaccessedTabs && (await getUserPreferences()).repositionTabs) {
      await ChromeWindowHelper.moveTabWithRetryHandler(tabId, { index: lastRelativeTabIndex });
    }
  }
}

export async function createActiveWindowTabGroup(windowId: ChromeWindowId, tabGroup: ChromeTabGroupWithId) {
  const myLogger = logger.createNestedLogger("createActiveWindowTabGroup");
  // 1. If focus mode is enabled, update the tab group color to the focused or non-focused color
  // 2. If the tab group is expanded but not focused, collapse the tab group
  // 3. If the tab group title is empty, update the tab group title to the title of the first tab in the group
  // 4. Add the new active window tab group to the active window
  try {
    const activeWindow = await ActiveWindow.getOrThrow(windowId);
    let newActiveWindowTabGroup = { ...tabGroup, useTabTitle: false, keepOpen: false };

    let tabGroupUpToDate: ChromeTabGroupWithId | undefined = tabGroup;

    const activeTab = (await chrome.tabs.query({ windowId, active: true }))[0] as ChromeTabWithId | undefined;
    const isFocusedTabGroup = activeTab?.groupId === tabGroup.id;

    // 1
    const { focusMode } = activeWindow;
    if (focusMode) {
      if (isFocusedTabGroup && focusMode.colors.focused !== tabGroupUpToDate.color) {
        tabGroupUpToDate = await ChromeWindowHelper.updateTabGroupWithRetryHandler(tabGroup.id, { color: focusMode.colors.focused });
      } else if (!isFocusedTabGroup && focusMode.colors.nonFocused !== tabGroupUpToDate.color) {
        tabGroupUpToDate = await ChromeWindowHelper.updateTabGroupWithRetryHandler(tabGroup.id, { color: focusMode.colors.nonFocused });
      }

      if (!tabGroupUpToDate) {
        return;
      }

      newActiveWindowTabGroup.color = tabGroupUpToDate.color;
    }

    // 2
    if (!tabGroupUpToDate.collapsed && !isFocusedTabGroup && (await Storage.getItems("userPreferences")).userPreferences.collapseUnfocusedTabGroups) {
      Logger.attentionLogger.log(`collapsing tab group ${tabGroup.id}`);
      tabGroupUpToDate = await ChromeWindowHelper.updateTabGroupWithRetryHandler(tabGroup.id, { collapsed: true });
      if (!tabGroupUpToDate) {
        return;
      }
      newActiveWindowTabGroup.collapsed = true;
    }

    // 3
    // TODO: check for `use tab title for blank tab groups` user preference
    const useTabTitle = Misc.isTabGroupTitleEmpty(tabGroupUpToDate.title);
    if (useTabTitle) {
      // FIXME: remove the timeout workaround once the chromium bug is resolved: https://issues.chromium.org/issues/334965868#comment4
      await Misc.waitMs(30);

      const tabsInGroup = (await chrome.tabs.query({ windowId: tabGroup.windowId, groupId: tabGroup.id })) as ChromeTabWithId[];
      const newTitle = ChromeWindowHelper.getTabTitleForUseTabTitle(tabsInGroup) ?? Misc.DEFAULT_TAB_GROUP_TITLE;

      tabGroupUpToDate = await ChromeWindowHelper.getIfTabGroupExists(tabGroup.id);
      if (!tabGroupUpToDate) {
        return;
      }

      if (Misc.isTabGroupTitleEmpty(tabGroupUpToDate.title)) {
        tabGroupUpToDate = await ChromeWindowHelper.updateTabGroupWithRetryHandler(tabGroup.id, { title: newTitle });
        if (!tabGroupUpToDate) {
          return;
        }

        newActiveWindowTabGroup = { ...newActiveWindowTabGroup, title: tabGroupUpToDate.title, useTabTitle: true };
      }
    }

    // 4
    await ActiveWindow.update(activeWindow.windowId, {
      tabGroups: [...activeWindow.tabGroups, newActiveWindowTabGroup],
    });
  } catch (error) {
    throw new Error(myLogger.getPrefixedMessage(`error:${error}`));
  }
}

async function runFocusTabGroupLikeOperation(
  windowId: ChromeWindowId,
  operation: (focusTabGroupOptions: {
    collapseUnfocusedTabGroups: boolean;
    highlightColors?: { focused: chrome.tabGroups.ColorEnum; nonFocused: chrome.tabGroups.ColorEnum };
    collapseIgnoreSet?: Set<ChromeTabGroupId>;
  }) => Promise<ChromeTabGroupWithId[] | undefined>
) {
  const activeWindow = await ActiveWindow.getOrThrow(windowId);
  const collapseIgnoreSet = new Set(activeWindow.tabGroups.filter((tabGroup) => tabGroup.keepOpen).map((tabGroup) => tabGroup.id));
  const focusTabGroupOptions = {
    collapseUnfocusedTabGroups: (await Storage.getItems("userPreferences")).userPreferences.collapseUnfocusedTabGroups,
    highlightColors: activeWindow.focusMode?.colors,
    collapseIgnoreSet,
  };

  const tabGroups = await operation(focusTabGroupOptions);
  if (tabGroups) {
    return await ActiveWindow.mergeIntoActiveWindowTabGroups(
      windowId,
      // TODO: we should only updated the properties that were actually updated from the ChromeWindowHelper.focusTabGroup
      //  call instead of naivly always updating the collapsed and color properties
      tabGroups.map((tabGroup) => ({ id: tabGroup.id, collapsed: tabGroup.collapsed, color: tabGroup.color }))
    );
  }
  return activeWindow;
}

export async function focusActiveTab(windowId: ChromeWindowId, tabId: ChromeTabId, tabGroupId: ChromeTabGroupId) {
  return await runFocusTabGroupLikeOperation(windowId, (focusTabGroupOptions) =>
    ChromeWindowHelper.focusActiveTabWithRetryHandler(tabId, tabGroupId, windowId, focusTabGroupOptions)
  );
}

export async function focusTabGroup(windowId: ChromeWindowId, tabGroupId: ChromeTabGroupId) {
  return await runFocusTabGroupLikeOperation(windowId, (focusTabGroupOptions) =>
    ChromeWindowHelper.focusTabGroupWithRetryHandler(tabGroupId, windowId, focusTabGroupOptions)
  );
}

export async function autoGroupTabAndHighlightedTabs(windowId: ChromeWindowId, tabId: ChromeTabId) {
  const myLogger = logger.createNestedLogger("autoGroupTabAndHighlightedTabs");
  try {
    const newGroupId = await ChromeWindowHelper.groupTabAndHighlightedTabsWithRetryHandler(tabId);
    if (newGroupId !== undefined) {
      const newTabGroup = await chrome.tabGroups.get(newGroupId);
      await createActiveWindowTabGroup(windowId, newTabGroup);
    }
    return newGroupId;
  } catch (error) {
    throw new Error(myLogger.getPrefixedMessage(`error:${error}`));
  }
}

export async function useTabTitleForEligebleTabGroups() {
  const myLogger = logger.createNestedLogger("autoNameAllTabGroups");
  try {
    const [activeWindows, windows] = await Promise.all([
      ActiveWindow.getAll(),
      chrome.windows.getAll({ windowTypes: ["normal"], populate: true }) as Promise<(ChromeWindowWithId & { tabs: ChromeTabWithId[] })[]>,
    ]);
    const activeWindowsSet = new Set(activeWindows.map((activeWindow) => activeWindow.windowId));
    const mouseInPage = MouseInPageTracker.isInPage();

    await Promise.all(
      windows.map(async (window) => {
        if (!activeWindowsSet.has(window.id) || (!mouseInPage && window.focused)) {
          return;
        }

        const tabsByGroupId = (window.tabs as ChromeTabWithId[]).reduce((acc, tab) => {
          if (tab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE) {
            acc[tab.groupId] = acc[tab.groupId] || [];
            acc[tab.groupId].push(tab);
          }
          return acc;
        }, {} as { [groupId: number]: ChromeTabWithId[] });

        await Promise.all(
          Object.entries(tabsByGroupId).map(async ([groupId, tabsInGroup]) => {
            const activeWindowTabGroup = await ActiveWindow.getActiveWindowTabGroup(window.id, parseInt(groupId));
            const tabTitle = ChromeWindowHelper.getTabTitleForUseTabTitle(tabsInGroup);
            if (!activeWindowTabGroup || !activeWindowTabGroup.useTabTitle || !tabTitle || activeWindowTabGroup.title === tabTitle) {
              return;
            }

            const updatedTabGroup = await ChromeWindowHelper.updateTabGroupWithRetryHandler(activeWindowTabGroup.id, { title: tabTitle });
            if (!updatedTabGroup) {
              return;
            }

            await ActiveWindow.updateActiveWindowTabGroup(updatedTabGroup.windowId, updatedTabGroup.id, { title: updatedTabGroup.title });
          })
        );
      })
    );
  } catch (error) {
    throw new Error(myLogger.getPrefixedMessage(`error:${error}`));
  }
}

export async function blurTabGroupsIfNoActiveTab(windowId: ChromeWindowId) {
  const [activeTab] = (await chrome.tabs.query({ active: true, windowId })) as (ChromeTabWithId | undefined)[];
  if (!activeTab) {
    await focusTabGroup(windowId, chrome.tabGroups.TAB_GROUP_ID_NONE);
  }
}

export async function groupUnpinnedAndUngroupedTabs(windowId: ChromeWindowId) {
  const newTabGroupId = await ChromeWindowHelper.groupUnpinnedAndUngroupedTabsWithRetryHandler(windowId);
  if (newTabGroupId) {
    const tabGroup = await chrome.tabGroups.get(newTabGroupId);
    await createActiveWindowTabGroup(windowId, tabGroup);
  }
}

export async function enableFocusMode(windowId: ChromeWindowId) {
  const myLogger = logger.createNestedLogger("enableFocusMode");
  try {
    if ((await ActiveWindow.getOrThrow(windowId)).focusMode) {
      throw new Error("Focus mode is already enabled");
    }

    const [tabGroups, { lastSeenFocusModeColors }] = await Promise.all([
      chrome.tabGroups.query({ windowId }) as Promise<Types.ChromeTabGroupWithId[]>,
      Storage.getItems(["lastSeenFocusModeColors"]),
    ]);

    await ActiveWindow.update(windowId, {
      focusMode: {
        colors: lastSeenFocusModeColors,
        savedTabGroupColors: tabGroups.map((tabGroup) => ({ tabGroupId: tabGroup.id, color: tabGroup.color })),
      },
    });

    const focusTabGroupOperation = async () => {
      const [activeTab] = (await chrome.tabs.query({ active: true, windowId })) as (ChromeTabWithId | undefined)[];
      return await focusTabGroup(windowId, activeTab?.groupId ?? chrome.tabGroups.TAB_GROUP_ID_NONE);
    };

    const setLastFocusedWindowHadFocusModeOperation = async () => {
      const window = await ChromeWindowHelper.getIfWindowExists(windowId);
      if (window?.focused) {
        await Storage.setItems({
          lastFocusedWindowHadFocusMode: true,
        });
      }
    };

    const [activeWindow] = await Promise.all([focusTabGroupOperation(), setLastFocusedWindowHadFocusModeOperation()]);
    return activeWindow;
  } catch (error) {
    throw new Error(myLogger.getPrefixedMessage(Misc.getErrorMessage(error)));
  }
}

export async function disableFocusMode(windowId: ChromeWindowId) {
  const myLogger = logger.createNestedLogger("disableFocusMode");
  try {
    const activeWindow = await ActiveWindow.getOrThrow(windowId);
    const { focusMode } = activeWindow;
    if (!focusMode) {
      throw new Error("Focus mode is already disabled");
    }

    const tabGroups = (await chrome.tabGroups.query({ windowId })) as Types.ChromeTabGroupWithId[];
    let colorIndex = 0;
    // Remove grey, just because it's not a very nice color
    const colors = ChromeWindowHelper.TAB_GROUP_COLORS.filter((color) => color !== "grey");
    const updatedTabGroups = (
      await Promise.all(
        tabGroups.map((tabGroup) => {
          let newColor: chrome.tabGroups.ColorEnum;
          const savedColor = focusMode.savedTabGroupColors.find((savedColor) => savedColor.tabGroupId === tabGroup.id)?.color;
          if (savedColor) {
            newColor = savedColor;
          } else {
            newColor = colors[colorIndex++ % colors.length];
          }

          return ChromeWindowHelper.updateTabGroupWithRetryHandler(tabGroup.id, { color: newColor });
        })
      )
    ).filter((tabGroup) => tabGroup !== undefined);
    await ActiveWindow.mergeIntoActiveWindowTabGroups(
      windowId,
      updatedTabGroups.map((tabGroup) => ({ id: tabGroup.id, color: tabGroup.color }))
    );
    return await ActiveWindow.update(windowId, { focusMode: null });
  } catch (error) {
    throw new Error(myLogger.getPrefixedMessage(Misc.getErrorMessage(error)));
  }
}
