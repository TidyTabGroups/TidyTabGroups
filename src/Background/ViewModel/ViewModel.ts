import ChromeWindowMethods from "../../Shared/ChromeWindowMethods";
import Logger from "../../Shared/Logger";
import Misc from "../../Shared/Misc";
import * as Model from "../Model/Model";
import * as MouseInPageTracker from "../MouseInPageTracker";
import Types from "../../Shared/Types";
import {
  ChromeWindowId,
  ChromeWindowWithId,
  ActiveWindowFocusModeColors,
  ChromeTabGroupId,
  ChromeTabWithId,
  ChromeTabGroupWithId,
  ChromeTabId,
  FocusTabGroupOptions,
  ActiveWindowTabGroup,
} from "../../Shared/Types/Types";
import Storage from "../../Shared/Storage";

const logger = Logger.createLogger("Background::ViewModel");

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

    const [windows, previousActiveWindows] = await Promise.all([
      chrome.windows.getAll() as Promise<ChromeWindowWithId[]>,
      Model.getAll(),
    ]);
    const windowIds = windows.map((window) => window.id);

    await Model.clear();

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

    const getUserPreferences = Misc.lazyCall(async () => {
      return (await Storage.getItems("userPreferences")).userPreferences;
    });

    let useTabTitleForGroupId: ChromeTabGroupId | null = null;
    if ((await getUserPreferences()).alwaysGroupTabs) {
      const newTabGroupId = await ChromeWindowMethods.groupUnpinnedAndUngroupedTabsWithRetryHandler(windowId);
      if (newTabGroupId) {
        const [newTabGroup, tabsInGroup] = await Promise.all([
          chrome.tabGroups.get(newTabGroupId),
          chrome.tabs.query({ groupId: newTabGroupId }) as Promise<ChromeTabWithId[]>,
        ]);

        if (Misc.isTabGroupTitleEmpty(newTabGroup.title) && (await getUserPreferences()).setTabGroupTitle) {
          const tabGroupUpToDate = await ChromeWindowMethods.updateTabGroupWithRetryHandler(newTabGroupId, {
            title: ChromeWindowMethods.getTabTitleForUseTabTitle(tabsInGroup) ?? Misc.DEFAULT_TAB_GROUP_TITLE,
          });

          if (tabGroupUpToDate) {
            useTabTitleForGroupId = newTabGroupId;
          }
        }
      }
    }

    const tabs = (await chrome.tabs.query({ windowId })) as ChromeTabWithId[];
    const activeTab = tabs.find((tab) => tab.active);
    const { userPreferences } = await Storage.getItems("userPreferences");
    await ChromeWindowMethods.focusTabGroupWithRetryHandler(
      activeTab ? activeTab.groupId : chrome.tabGroups.TAB_GROUP_ID_NONE,
      windowId,
      {
        collapseUnfocusedTabGroups: userPreferences.collapseUnfocusedTabGroups,
        highlightColors: newFocusModeColors
          ? { ...newFocusModeColors, highlightPrevActiveTabGroup: userPreferences.highlightPrevActiveTabGroup }
          : undefined,
      },
      true
    );

    const tabGroups = (await chrome.tabGroups.query({ windowId })) as ChromeTabGroupWithId[];
    const lastActiveOrGreatestIndexTabByGroupId = await ChromeWindowMethods.getLastAccessedOrGreatestIndexTabByGroupId(tabs);

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
        return Model.chromeTabGroupToActiveWindowTabGroup(tabGroup, {
          useTabTitle: useTabTitleForGroupId === tabGroup.id,
          lastActiveTabId: lastActiveOrGreatestIndexTabByGroupId[tabGroup.id]?.id || null,
        });
      }),
    } as Types.ActiveWindow;

    await Model.add(newActiveWindow);
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
  const activeWindow = await Model.get(windowId);
  if (!activeWindow) {
    throw new Error(`deactivateWindow::windowId ${windowId} not found`);
  }

  await Model.remove(windowId);
}

export async function repositionTab(windowId: ChromeWindowId, tabId: ChromeTabId) {
  const activeWindow = await Model.getOrThrow(windowId);

  const tabs = (await chrome.tabs.query({ windowId })) as ChromeTabWithId[];
  const tab = tabs.find((tab) => tab.id === tabId);
  if (!tab) {
    throw new Error(`repositionTab::tabId ${tabId} not found in windowId ${windowId}`);
  }

  // Pinned tabs do not get repositioned
  if (tab.pinned) {
    return;
  }

  const getUserPreferences = Misc.lazyCall(async () => {
    return (await Storage.getItems("userPreferences")).userPreferences;
  });

  // If the tab is in a tab group, lastRelativeTabIndex will be the last tab in the group, otherwise it will be the last tab in the window
  let lastRelativeTabIndex = tabs[tabs.length - 1].index;

  /* Reposition the tab's group to the end */
  if (tab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE) {
    const tabsInGroup = tabs.filter((otherTab) => otherTab.groupId === tab.groupId);
    const lastTabInGroup = tabsInGroup[tabsInGroup.length - 1];
    if (lastTabInGroup.index < tabs[tabs.length - 1].index && (await getUserPreferences()).repositionTabGroups) {
      await ChromeWindowMethods.moveTabGroupWithRetryHandler(tab.groupId, { index: -1 });
    } else {
      lastRelativeTabIndex = lastTabInGroup.index;
    }
  }

  /* Reposition the tab to the end */
  if (tab.index > lastRelativeTabIndex || !(await getUserPreferences()).repositionTabs) {
    return;
  }

  // If the tab opened any un-accessed tabs that are positioned after it, then dont move it
  const isOpenerOfUnaccessedTabs = tabs.some((t) => t.openerTabId === tab.id && t.lastAccessed === undefined && t.index > tab.index);
  if (!isOpenerOfUnaccessedTabs) {
    await ChromeWindowMethods.moveTabWithRetryHandler(tabId, { index: lastRelativeTabIndex });
  }
}

export async function createActiveWindowTabGroup(windowId: ChromeWindowId, tabGroup: ChromeTabGroupWithId) {
  const myLogger = logger.createNestedLogger("createActiveWindowTabGroup");
  // 1. If focus mode is enabled, update the tab group color to the focused or non-focused color
  // 2. If the tab group is expanded but not focused, collapse the tab group
  // 3. If the tab group title is empty, update the tab group title to the title of the first tab in the group
  // 4. Add the new active window tab group to the active window
  try {
    const existingActiveWindowTabGroup = await Model.getActiveWindowTabGroup(windowId, tabGroup.id);
    if (existingActiveWindowTabGroup) {
      throw new Error(`tabGroup with id ${tabGroup.id} already exists in window with id ${windowId}`);
    }

    const activeWindow = await Model.getOrThrow(windowId);
    const tabsInGroup = (await chrome.tabs.query({ windowId, groupId: tabGroup.id })) as ChromeTabWithId[];
    const lastAccessedOrGreatestIndexTab = await ChromeWindowMethods.getLastAccessedOrGreatestIndexTab(tabsInGroup);
    let newActiveWindowTabGroup: ActiveWindowTabGroup = {
      ...tabGroup,
      useTabTitle: false,
      keepOpen: false,
      lastActiveTabId: lastAccessedOrGreatestIndexTab?.id ?? null,
    };

    let tabGroupUpToDate: ChromeTabGroupWithId | undefined = tabGroup;
    const isFocusedTabGroup = tabsInGroup.some((tab) => tab.active);
    const getUserPreferences = Misc.lazyCall(async () => {
      return (await Storage.getItems("userPreferences")).userPreferences;
    });

    // 1
    const { focusMode } = activeWindow;
    if (focusMode) {
      if (isFocusedTabGroup && focusMode.colors.focused !== tabGroupUpToDate.color) {
        tabGroupUpToDate = await ChromeWindowMethods.updateTabGroupWithRetryHandler(tabGroup.id, { color: focusMode.colors.focused });
      } else if (!isFocusedTabGroup && focusMode.colors.nonFocused !== tabGroupUpToDate.color) {
        tabGroupUpToDate = await ChromeWindowMethods.updateTabGroupWithRetryHandler(tabGroup.id, { color: focusMode.colors.nonFocused });
      }

      if (!tabGroupUpToDate) {
        return;
      }

      newActiveWindowTabGroup.color = tabGroupUpToDate.color;
    }

    // 2
    if (!tabGroupUpToDate.collapsed && !isFocusedTabGroup && (await getUserPreferences()).collapseUnfocusedTabGroups) {
      tabGroupUpToDate = await ChromeWindowMethods.updateTabGroupWithRetryHandler(tabGroup.id, { collapsed: true });
      if (!tabGroupUpToDate) {
        return;
      }
      newActiveWindowTabGroup.collapsed = true;
    }

    // 3
    const useTabTitle = Misc.isTabGroupTitleEmpty(tabGroupUpToDate.title) && (await getUserPreferences()).setTabGroupTitle;
    if (useTabTitle) {
      // FIXME: remove the timeout workaround once the chromium bug is resolved: https://issues.chromium.org/issues/334965868#comment4
      await Misc.waitMs(30);

      const tabsInGroup = (await chrome.tabs.query({ windowId: tabGroup.windowId, groupId: tabGroup.id })) as ChromeTabWithId[];
      const newTitle = ChromeWindowMethods.getTabTitleForUseTabTitle(tabsInGroup) ?? Misc.DEFAULT_TAB_GROUP_TITLE;

      tabGroupUpToDate = await ChromeWindowMethods.getIfTabGroupExists(tabGroup.id);
      if (!tabGroupUpToDate) {
        return;
      }

      if (Misc.isTabGroupTitleEmpty(tabGroupUpToDate.title)) {
        tabGroupUpToDate = await ChromeWindowMethods.updateTabGroupWithRetryHandler(tabGroup.id, { title: newTitle });
        if (!tabGroupUpToDate) {
          return;
        }

        newActiveWindowTabGroup = { ...newActiveWindowTabGroup, title: tabGroupUpToDate.title, useTabTitle: true };
      }
    }

    // 4
    await Model.addActiveWindowTabGroup(windowId, newActiveWindowTabGroup);
  } catch (error) {
    throw new Error(myLogger.getPrefixedMessage(`error:${error}`));
  }
}

async function runFocusTabGroupLikeOperation(
  windowId: ChromeWindowId,
  operation: (focusTabGroupOptions: FocusTabGroupOptions) => Promise<ChromeTabGroupWithId[] | undefined>
) {
  const activeWindow = await Model.getOrThrow(windowId);

  const collapseIgnoreSet = new Set(activeWindow.tabGroups.filter((tabGroup) => tabGroup.keepOpen).map((tabGroup) => tabGroup.id));
  const { userPreferences } = await Storage.getItems("userPreferences");

  const focusTabGroupOptions = {
    collapseUnfocusedTabGroups: userPreferences.collapseUnfocusedTabGroups,
    highlightColors: activeWindow.focusMode?.colors
      ? { ...activeWindow.focusMode.colors, highlightPrevActiveTabGroup: userPreferences.highlightPrevActiveTabGroup }
      : undefined,
    collapseIgnoreSet,
  };

  const tabGroups = await operation(focusTabGroupOptions);
  if (tabGroups) {
    return await Model.updateActiveWindowTabGroups(
      windowId,
      // TODO: we should only updated the properties that were actually updated from the ChromeWindowMethods.focusTabGroup
      //  call instead of naivly always updating the collapsed and color properties
      tabGroups.map((tabGroup) => ({ id: tabGroup.id, collapsed: tabGroup.collapsed, color: tabGroup.color }))
    );
  }
  return activeWindow;
}

export async function focusActiveTab(windowId: ChromeWindowId, tabId: ChromeTabId, tabGroupId: ChromeTabGroupId) {
  const myLogger = logger.createNestedLogger("focusActiveTab");
  try {
    return await runFocusTabGroupLikeOperation(windowId, (focusTabGroupOptions) =>
      ChromeWindowMethods.focusActiveTabWithRetryHandler(tabId, tabGroupId, windowId, focusTabGroupOptions)
    );
  } catch (error) {
    throw new Error(myLogger.getPrefixedMessage(Misc.getErrorMessage(error)));
  }
}

export async function focusTabGroup(windowId: ChromeWindowId, tabGroupId: ChromeTabGroupId) {
  return await runFocusTabGroupLikeOperation(windowId, (focusTabGroupOptions) =>
    ChromeWindowMethods.focusTabGroupWithRetryHandler(tabGroupId, windowId, focusTabGroupOptions)
  );
}

export async function autoGroupTabAndHighlightedTabs(windowId: ChromeWindowId, tabId: ChromeTabId) {
  const myLogger = logger.createNestedLogger("autoGroupTabAndHighlightedTabs");
  try {
    const newGroupId = await ChromeWindowMethods.groupTabAndHighlightedTabsWithRetryHandler(tabId);
    if (newGroupId !== undefined) {
      const newTabGroup = await chrome.tabGroups.get(newGroupId);
      await createActiveWindowTabGroup(windowId, newTabGroup);
    }
    return newGroupId;
  } catch (error) {
    throw new Error(myLogger.getPrefixedMessage(`error:${error}`));
  }
}

// TODO: This should be broken down into smaller functions
export async function useTabTitleForEligebleTabGroups() {
  const myLogger = logger.createNestedLogger("useTabTitleForEligebleTabGroups");
  try {
    const { userPreferences } = await Storage.getItems("userPreferences");
    if (!userPreferences.setTabGroupTitle) {
      return;
    }

    const [activeWindows, windows] = await Promise.all([
      Model.getAll(),
      chrome.windows.getAll({ windowTypes: ["normal"], populate: true }) as Promise<(ChromeWindowWithId & { tabs: ChromeTabWithId[] })[]>,
    ]);
    const activeWindowsSet = new Set(activeWindows.map((activeWindow) => activeWindow.windowId));
    const mouseInPage = await MouseInPageTracker.isInPage();

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
            const activeWindowTabGroup = await Model.getActiveWindowTabGroup(window.id, parseInt(groupId));
            const tabTitle = ChromeWindowMethods.getTabTitleForUseTabTitle(tabsInGroup);
            if (!activeWindowTabGroup || !activeWindowTabGroup.useTabTitle || !tabTitle || activeWindowTabGroup.title === tabTitle) {
              return;
            }

            const updatedTabGroup = await ChromeWindowMethods.updateTabGroupWithRetryHandler(activeWindowTabGroup.id, { title: tabTitle });
            if (!updatedTabGroup) {
              return;
            }

            await Model.updateActiveWindowTabGroup(updatedTabGroup.windowId, updatedTabGroup.id, { title: updatedTabGroup.title });
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
  const newTabGroupId = await ChromeWindowMethods.groupUnpinnedAndUngroupedTabsWithRetryHandler(windowId);
  if (newTabGroupId) {
    const tabGroup = await chrome.tabGroups.get(newTabGroupId);
    await createActiveWindowTabGroup(windowId, tabGroup);
  }
}

export async function enableFocusMode(windowId: ChromeWindowId) {
  const myLogger = logger.createNestedLogger("enableFocusMode");
  try {
    if ((await Model.getOrThrow(windowId)).focusMode) {
      throw new Error("Focus mode is already enabled");
    }

    const [tabGroups, { lastSeenFocusModeColors }] = await Promise.all([
      chrome.tabGroups.query({ windowId }) as Promise<Types.ChromeTabGroupWithId[]>,
      Storage.getItems(["lastSeenFocusModeColors"]),
    ]);

    await Model.update(windowId, {
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
      const window = await ChromeWindowMethods.getIfWindowExists(windowId);
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
    const activeWindow = await Model.getOrThrow(windowId);
    const { focusMode } = activeWindow;
    if (!focusMode) {
      throw new Error("Focus mode is already disabled");
    }

    const tabGroups = (await chrome.tabGroups.query({ windowId })) as Types.ChromeTabGroupWithId[];
    let colorIndex = 0;
    // Remove grey, just because it's not a very nice color
    const colors = ChromeWindowMethods.TAB_GROUP_COLORS.filter((color) => color !== "grey");
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

          return ChromeWindowMethods.updateTabGroupWithRetryHandler(tabGroup.id, { color: newColor });
        })
      )
    ).filter((tabGroup) => tabGroup !== undefined);
    await Model.updateActiveWindowTabGroups(
      windowId,
      updatedTabGroups.map((tabGroup) => ({ id: tabGroup.id, color: tabGroup.color }))
    );
    return await Model.update(windowId, { focusMode: null });
  } catch (error) {
    throw new Error(myLogger.getPrefixedMessage(Misc.getErrorMessage(error)));
  }
}

export async function activateLastActiveTabInGroup(windowId: ChromeWindowId, groupId: ChromeTabGroupId) {
  const myLogger = logger.createNestedLogger("activateLastActiveTabInGroup");
  try {
    const [activeWindowTabGroup, tabsInGroup, { userPreferences }] = await Promise.all([
      Model.getActiveWindowTabGroupOrThrow(windowId, groupId),
      chrome.tabs.query({ windowId, groupId }) as Promise<ChromeTabWithId[]>,
      Storage.getItems("userPreferences"),
    ]);

    const activeTabIsInGroup = tabsInGroup.some((tab) => tab.active);
    if (!userPreferences.activateTabInFocusedTabGroup || activeTabIsInGroup) {
      return;
    }

    let tabToActivate: ChromeTabWithId | undefined;
    // TODO: Remove this when https://issues.chromium.org/issues/326678907 gets fixed
    if (activeWindowTabGroup.lastActiveTabId !== null) {
      tabToActivate = await ChromeWindowMethods.getIfTabExists(activeWindowTabGroup.lastActiveTabId);
      if (!tabToActivate) {
        myLogger.warn(`wasExpanded: lastActiveTabId with id ${activeWindowTabGroup.lastActiveTabId} does not exist`);
      }
    }

    if (!tabToActivate) {
      tabToActivate = await ChromeWindowMethods.getLastAccessedOrGreatestIndexTab(tabsInGroup);
      if (!tabToActivate) {
        return;
      }
    }

    // start loading the tab now (before waiting for the animations to finish)
    if (tabToActivate.status === "unloaded") {
      chrome.tabs.update(tabToActivate.id, { url: tabToActivate.url }).catch((error) => myLogger.error(`error discarding tab:${error}`));
    }
    // wait for the tab group uncollapse animations to finish before activatiing the last tab in the group
    const timeToWaitBeforeActivation = Misc.serviceWorkerJustWokeUp() ? 100 : 250;
    await Misc.waitMs(timeToWaitBeforeActivation);

    const tabGroupUpToDate = await ChromeWindowMethods.getIfTabGroupExists(groupId);
    if (!tabGroupUpToDate || tabGroupUpToDate.collapsed) {
      return;
    }

    await ChromeWindowMethods.activateTabWithRetryHandler(tabToActivate.id);
  } catch (error) {
    throw new Error(myLogger.getPrefixedMessage(Misc.getErrorMessage(error)));
  }
}

export async function updateLastActiveTabIdForTabGroupWithTabId(tabId: ChromeTabId) {
  const myLogger = logger.createNestedLogger("updateLastActiveTabIdForTabGroupWithTabId");
  try {
    const activeWindowTabGroups = await Model.getAllActiveWindowTabGroups();
    const activeWindowTabGroup = activeWindowTabGroups.find((activeWindowTabGroup) => activeWindowTabGroup.lastActiveTabId === tabId);
    if (activeWindowTabGroup) {
      const tabsInGroup = (await chrome.tabs.query({
        windowId: activeWindowTabGroup.windowId,
        groupId: activeWindowTabGroup.id,
      })) as ChromeTabWithId[];
      const lastAccessedOrGreatestIndexTab = await ChromeWindowMethods.getLastAccessedOrGreatestIndexTab(tabsInGroup);
      await Model.updateActiveWindowTabGroup(activeWindowTabGroup.windowId, activeWindowTabGroup.id, {
        lastActiveTabId: lastAccessedOrGreatestIndexTab?.id ?? null,
      });
    }
  } catch (error) {
    throw new Error(myLogger.getPrefixedMessage(Misc.getErrorMessage(error)));
  }
}

export async function updateFocusModeColorForTabGroupWithColor(
  windowId: ChromeWindowId,
  groupId: ChromeTabGroupId,
  color: chrome.tabGroups.ColorEnum
) {
  const myLogger = logger.createNestedLogger("updateFocusModeColorForTabGroupWithColor");
  try {
    const activeWindow = await Model.getOrThrow(windowId);
    if (activeWindow.focusMode === null) {
      return;
    }

    const [lastAccessedTabGroupId, activeTab, { userPreferences }] = await Promise.all([
      ChromeWindowMethods.getLastAccessedTabGroupId(windowId),
      (await chrome.tabs.query({ windowId, active: true }))[0] as ChromeTabWithId | undefined,
      Storage.getItems("userPreferences"),
    ]);

    let focusedTabGroupId: ChromeTabGroupId;
    if (userPreferences.highlightPrevActiveTabGroup && lastAccessedTabGroupId !== undefined) {
      focusedTabGroupId = lastAccessedTabGroupId;
    } else if (activeTab) {
      focusedTabGroupId = activeTab.groupId;
    } else {
      focusedTabGroupId = chrome.tabGroups.TAB_GROUP_ID_NONE;
    }

    const isFocusedTabGroup = groupId === focusedTabGroupId;
    let newFocusModeColors;

    if (isFocusedTabGroup) {
      newFocusModeColors = { ...activeWindow.focusMode.colors, focused: color };
      await Model.update(activeWindow.windowId, { focusMode: { ...activeWindow.focusMode, colors: newFocusModeColors } });
    } else {
      newFocusModeColors = { ...activeWindow.focusMode.colors, nonFocused: color };
      await Model.update(activeWindow.windowId, { focusMode: { ...activeWindow.focusMode, colors: newFocusModeColors } });
      // this will effectively update the color of all other non-focused tab groups
      await focusTabGroup(activeWindow.windowId, activeTab?.groupId ?? chrome.tabGroups.TAB_GROUP_ID_NONE);
    }

    const window = await ChromeWindowMethods.getIfWindowExists(windowId);
    if (window?.focused) {
      await Storage.setItems({ lastSeenFocusModeColors: newFocusModeColors });
    }
  } catch (error) {
    throw new Error(myLogger.getPrefixedMessage(Misc.getErrorMessage(error)));
  }
}

export async function createActiveWindowTabGroupIfNotExists(windowId: ChromeWindowId, tabGroupId: ChromeTabGroupId) {
  const myLogger = logger.createNestedLogger("createActiveWindowTabGroupIfNotExists");
  try {
    const [tabGroup, activeWindowTabGroup] = await Promise.all([
      ChromeWindowMethods.getIfTabGroupExists(tabGroupId),
      Model.getActiveWindowTabGroup(windowId, tabGroupId),
    ]);

    if (!tabGroup) {
      myLogger.warn(`tab group with id ${tabGroupId} does not exist`);
      return;
    }

    if (!activeWindowTabGroup) {
      return await createActiveWindowTabGroup(windowId, tabGroup);
    }
  } catch (error) {
    throw new Error(myLogger.getPrefixedMessage(Misc.getErrorMessage(error)));
  }
}
