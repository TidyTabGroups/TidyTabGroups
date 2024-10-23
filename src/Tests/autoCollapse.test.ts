import Misc from "../Shared/Misc";
import { test, expect } from "./Fixtures/Fixture";

test("Previous active tab group becomes collapsed", async ({ chromeProxy }) => {
  const activeTabGroupTitle = " * Active * ";
  const activeTab = await test.step("Create active tab group", async () => {
    // Create active tab
    const becomesGroupedPromise = chromeProxy.waitFor(
      "tabs.onUpdated",
      async (tabId, changeInfo, tab) => {
        return (
          tabId === activeTab.id &&
          changeInfo.groupId !== undefined &&
          changeInfo.groupId !== chromeProxy.tabGroups.TAB_GROUP_ID_NONE
        );
      }
    );
    let activeTab = await chromeProxy.tabs.create({ pinned: false, active: true });
    await becomesGroupedPromise;
    activeTab = await chromeProxy.tabs.get(activeTab.id);

    // Update Title for easier debugging
    await chromeProxy.tabGroups.update(activeTab.groupId, { title: activeTabGroupTitle });

    return activeTab;
  });

  const nonActiveTabGroupTitle = " * Non-Active * ";
  const nonActiveTab = await test.step("Create non-active tab group", async () => {
    //  Create non-active tab
    const becomesGroupedPromise = chromeProxy.waitFor(
      "tabs.onUpdated",
      async (tabId, changeInfo, tab) => {
        return tabId === nonActiveTab.id && changeInfo.groupId === activeTab.groupId;
      }
    );
    let nonActiveTab = await chromeProxy.tabs.create({
      pinned: false,
      windowId: activeTab.windowId,
      active: false,
    });
    await becomesGroupedPromise;
    nonActiveTab = await chromeProxy.tabs.get(nonActiveTab.id);

    // Create non-active tab group
    const becomesCollapsedPromise = chromeProxy.waitFor("tabGroups.onUpdated", async (tabGroup) => {
      return tabGroup.id === nonActiveTabGroupId && tabGroup.collapsed === true;
    });
    const nonActiveTabGroupId = await chromeProxy.tabs.group({
      tabIds: [nonActiveTab.id],
      createProperties: { windowId: nonActiveTab.windowId },
    });
    nonActiveTab = await chromeProxy.tabs.get(nonActiveTab.id);
    let nonActiveTabGroup = await chromeProxy.tabGroups.update(nonActiveTabGroupId, {
      // Update title for easier debugging
      title: nonActiveTabGroupTitle,
    });

    if (!nonActiveTabGroup.collapsed) {
      await becomesCollapsedPromise;
      nonActiveTabGroup = await chromeProxy.tabGroups.get(nonActiveTabGroupId);
      if (!nonActiveTabGroup.collapsed) {
        throw new Error("nonActiveTabGroup is not collapsed");
      }
    }

    return nonActiveTab;
  });

  // Expand non-active tab group and wait for previous active tab group to become collapsed
  const previousActiveTabGroupBecomesCollapsedPromise = chromeProxy.waitFor(
    "tabGroups.onUpdated",
    async (tabGroup) => {
      return tabGroup.id === activeTab.groupId && tabGroup.collapsed === true;
    }
  );
  await chromeProxy.tabGroups.update(nonActiveTab.groupId, { collapsed: false });
  await previousActiveTabGroupBecomesCollapsedPromise;

  expect(true).toBe(true);
});
