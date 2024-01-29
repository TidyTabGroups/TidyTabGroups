import { ChromeTabWithId, ChromeWindowId } from "../../types";
import * as Utils from "../misc";

export async function validateWindow(windowId: ChromeWindowId) {
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

    const tabsInFirstTabGroup = Utils.getTabsWithIds(await chrome.tabs.query({ windowId, groupId: firstTabGroup.id }));
    const tabsInSecondTabGroup = Utils.getTabsWithIds(
      await chrome.tabs.query({ windowId, groupId: secondTabGroup.id })
    );
    if (tabsInFirstTabGroup[0].index > tabsInSecondTabGroup[0].index) {
      console.warn(`TidyTabsShapeValidator::validateWindow::Window ${windowId} has tab groups in wrong order`);
      return false;
    }

    // check #5
    if (firstTabGroup.title !== Utils.SECONDARY_TAB_GROUP_TITLE) {
      console.warn(`TidyTabsShapeValidator::validateWindow::Window ${windowId} has wrong secondary tab group title`);
      return false;
    }

    // check #6
    if (validatePrimaryTabs(tabsInFirstTabGroup)) {
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

export function validatePrimaryTabs(tabs: ChromeTabWithId[]) {
  return tabs.length === Utils.MAX_PRIMARY_TABS;
}

export function validateSecondaryTabs(tabs: ChromeTabWithId[]) {
  return tabs.length > 0;
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

    const secondaryTabs = Utils.getTabsWithIds(
      await chrome.tabs.query({
        windowId,
        groupId: secondaryTabGroup.id,
      })
    );

    const primaryTabs = Utils.getTabsWithIds(
      await chrome.tabs.query({
        windowId,
        groupId: primaryTabGroup.id,
      })
    );

    if (!validatePrimaryTabs(primaryTabs) || !validateSecondaryTabs(secondaryTabs)) {
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
