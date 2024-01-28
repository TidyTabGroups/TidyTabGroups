import {
  ChromeTabId,
  ChromeWindowId,
  ChromeTabWithId,
  ChromeWindowWithId,
  TabGroupCreationOptions,
  TidyTabs,
} from "../types";
import { DataModelManager } from "../model";

export const SECONDARY_TAB_GROUP_TITLE = "      ←      ";
export const MAX_PRIMARY_TABS = 1;

export function getWindowsWithIds(windows: chrome.windows.Window[]) {
  // "Under some circumstances a Window may not be assigned an ID, for example when querying windows using the sessions API, in which case a session ID may be present."
  return windows.filter(
    (window) => window.id !== undefined && window.id !== chrome.windows.WINDOW_ID_NONE
  ) as Array<ChromeWindowWithId>;
}

export function getTabsWithIds(tabs: chrome.tabs.Tab[]) {
  // "Under some circumstances a Tab may not be assigned an ID, for example when querying foreign tabs using the sessions API, in which case a session ID may be present. Tab ID can also be set to chrome.tabs.TAB_ID_NONE for apps and devtools windows."
  return tabs.filter((tab) => tab.id !== undefined && tab.id !== chrome.tabs.TAB_ID_NONE) as Array<ChromeTabWithId>;
}

export async function createTabGroup(tabIds: [ChromeTabId], options?: TabGroupCreationOptions) {
  try {
    const { windowId, title, color } = options || {};
    const tabGroupId = await chrome.tabs.group({ tabIds, createProperties: { windowId } });
    if (title || color) {
      await chrome.tabGroups.update(tabGroupId, { title, color });
    }
    return tabGroupId;
  } catch (error) {
    console.error(`TidyTabsChromeHelper::createTabGroup::Error ${error}`);
    throw error;
  }
}

// Note: This method does not completely validate that the window is in complete tidy tabs space shape. It only extracts the tidy tabs info
//  from the window. It is up to the caller to validate that the window is in tidy tabs space shape.
export async function extractActiveDataFromWindowInTidyTabsSpaceShape(windowId: ChromeWindowId) {
  try {
    const tabGroups = await chrome.tabGroups.query({ windowId });
    const secondaryTabGroup = tabGroups[0];
    const primaryTabGroup = tabGroups[1];

    if (!secondaryTabGroup || !primaryTabGroup) {
      const errorMessage = `Could not extract tab groups from supposed Window in tidy tabs space shape: ${windowId}`;
      console.error(`TidyTabsSpaceModel::createWithExistingWindow::Error: ${errorMessage}`);
      throw new Error(errorMessage);
    }

    const secondaryTabs = getTabsWithIds(
      await chrome.tabs.query({
        windowId,
        groupId: secondaryTabGroup.id,
      })
    );

    const primaryTabs = getTabsWithIds(
      await chrome.tabs.query({
        windowId,
        groupId: primaryTabGroup.id,
      })
    );

    if (
      !TidyTabsShapeValidator.validatePrimaryTabs(primaryTabs) ||
      !TidyTabsShapeValidator.validateSecondaryTabs(secondaryTabs)
    ) {
      const errorMessage = `Could not extract tab group tabs from supposed Window in tidy tabs space shape: ${windowId}`;
      console.error(`TidyTabsSpaceModel::createWithExistingWindow::Error: ${errorMessage}`);
      throw new Error(errorMessage);
    }

    let activeTab: ChromeTabWithId | undefined;
    const primaryTab = primaryTabs[0];
    if (primaryTab.active) {
      activeTab = primaryTab;
    } else {
      let activeTabInSecondaryTabGroup = secondaryTabs.find((tab) => tab.active);
      if (activeTabInSecondaryTabGroup) {
        activeTab = activeTabInSecondaryTabGroup;
      }
    }

    return { activeTab, primaryTab, secondaryTabs, primaryTabGroup, secondaryTabGroup };
  } catch (error) {
    console.error(`utils::extractActiveDataFromWindowInTidyTabsSpaceShape::Error ${error}`);
    throw error;
  }
}

export async function useOrGetDataModel(dataModel?: TidyTabs.DataModel) {
  function isDataModel(dataModel?: TidyTabs.DataModel) {
    // TODO: check the type and shape?
    return !!dataModel;
  }

  return isDataModel(dataModel) ? dataModel! : await DataModelManager.get();
}

export class TidyTabsShapeValidator {
  static async validateWindow(windowId: ChromeWindowId) {
    try {
      /*
        1. the window has at least 2 non-pinned tabs
        2. the window has 0 non-pinned tabs without a tab group
        3. the window has only 2 tab groups
        4. the first tab group's position is before the second tab group
        5. the first tab group must be secondary tab group (ie. it has the title SECONDARY_TAB_GROUP_TITLE)
        6. the second group must only contain MAX_PRIMARY_TABS tab(s)
      */

      const nonPinnedTabs = await chrome.tabs.query({ windowId, pinned: false });

      // check #1
      if (nonPinnedTabs.length < 2) {
        console.warn(`TidyTabsShapeValidator::validateWindow::Window ${windowId} has less than 2 non-pinned tabs`);
        return false;
      }

      // check #2
      const tabWithoutGroup = nonPinnedTabs.find((tab) => tab.groupId === chrome.tabGroups.TAB_GROUP_ID_NONE);
      if (!!tabWithoutGroup) {
        console.warn(
          `TidyTabsShapeValidator::validateWindow::Window ${windowId} has a non-pinned tab without a tab group`
        );
        return false;
      }

      // check #3
      const tabGroups = await chrome.tabGroups.query({ windowId });
      if (tabGroups.length !== 2) {
        console.warn(`TidyTabsShapeValidator::validateWindow::Window ${windowId} has more than 2 tab groups`);
        return false;
      }

      // check #4
      const firstTabGroup = tabGroups[0];
      const secondTabGroup = tabGroups[1];

      const tabsInFirstTabGroup = getTabsWithIds(await chrome.tabs.query({ windowId, groupId: firstTabGroup.id }));
      const tabsInSecondTabGroup = getTabsWithIds(await chrome.tabs.query({ windowId, groupId: secondTabGroup.id }));
      if (tabsInFirstTabGroup[0].index > tabsInSecondTabGroup[0].index) {
        console.warn(`TidyTabsShapeValidator::validateWindow::Window ${windowId} has tab groups in wrong order`);
        return false;
      }

      // check #5
      if (firstTabGroup.title !== SECONDARY_TAB_GROUP_TITLE) {
        console.warn(`TidyTabsShapeValidator::validateWindow::Window ${windowId} has wrong secondary tab group title`);
        return false;
      }

      // check #6
      if (TidyTabsShapeValidator.validatePrimaryTabs(tabsInFirstTabGroup)) {
        console.warn(`TidyTabsShapeValidator::validateWindow::Window ${windowId} has invalid primary tabs`);
        return false;
      }

      return true;
    } catch (error) {
      const errorMessage = `TidyTabsSpaceModel::createWithExistingWindow::Error: ${error}`;
      console.error(errorMessage);
      throw new Error(errorMessage);
    }
  }

  static validatePrimaryTabs(tabs: ChromeTabWithId[]) {
    return tabs.length === MAX_PRIMARY_TABS;
  }

  static validateSecondaryTabs(tabs: ChromeTabWithId[]) {
    return tabs.length > 0;
  }
}
