import Misc from "../Shared/Misc";
import { test, expect } from "./Fixtures/Fixture";

test("Previous active tab group becomes collapsed", async ({ chromeProxy }) => {
  const activeTabGroupTitle = " * Active * ";
  const activeTab = await test.step("Create active tab group", async () => {
    // Create active tab
    const becomesGroupedPromise = await chromeProxy.waitFor(
      "tabs.onUpdated",
      async (tabId, changeInfo, tab) => {
        const activeTab = await activeTabPromise;
        return (
          tabId === activeTab.id &&
          changeInfo.groupId !== undefined &&
          changeInfo.groupId !== chromeProxy.tabGroups.TAB_GROUP_ID_NONE
        );
      }
    );
    const activeTabPromise = chromeProxy.tabs.create({ pinned: false, active: true });
    let activeTab = await activeTabPromise;
    await becomesGroupedPromise.waitForValidEventArgs;
    activeTab = await chromeProxy.tabs.get(activeTab.id);

    // Update Title for easier debugging
    await chromeProxy.tabGroups.update(activeTab.groupId, { title: activeTabGroupTitle });

    return activeTab;
  });

  const nonActiveTabGroupTitle = " * Non-Active * ";
  const nonActiveTab = await test.step("Create non-active tab group", async () => {
    //  Create non-active tab
    const becomesGroupedPromise = await chromeProxy.waitFor(
      "tabs.onUpdated",
      async (tabId, changeInfo, tab) => {
        const nonActiveTab = await nonActiveTabPromise;
        return tabId === nonActiveTab.id && changeInfo.groupId === activeTab.groupId;
      }
    );
    const nonActiveTabPromise = chromeProxy.tabs.create({
      pinned: false,
      windowId: activeTab.windowId,
      active: false,
    });
    let nonActiveTab = await nonActiveTabPromise;
    await becomesGroupedPromise.waitForValidEventArgs;
    nonActiveTab = await chromeProxy.tabs.get(nonActiveTab.id);

    // Create non-active tab group
    const becomesCollapsedPromise = await chromeProxy.waitFor(
      "tabGroups.onUpdated",
      async (tabGroup) => {
        const nonActiveTabGroupId = await nonActiveTabGroupIdPromise;
        return tabGroup.id === nonActiveTabGroupId && tabGroup.collapsed === true;
      }
    );
    const nonActiveTabGroupIdPromise = chromeProxy.tabs.group({
      tabIds: [nonActiveTab.id],
      createProperties: { windowId: nonActiveTab.windowId },
    });
    const nonActiveTabGroupId = await nonActiveTabGroupIdPromise;
    nonActiveTab = await chromeProxy.tabs.get(nonActiveTab.id);
    let nonActiveTabGroup = await chromeProxy.tabGroups.update(nonActiveTabGroupId, {
      // Update title for easier debugging
      title: nonActiveTabGroupTitle,
    });

    if (!nonActiveTabGroup.collapsed) {
      await becomesCollapsedPromise.waitForValidEventArgs;
      nonActiveTabGroup = await chromeProxy.tabGroups.get(nonActiveTabGroupId);
      if (!nonActiveTabGroup.collapsed) {
        throw new Error("nonActiveTabGroup is not collapsed");
      }
    }

    return nonActiveTab;
  });

  // Expand non-active tab group and wait for previous active tab group to become collapsed
  const previousActiveTabGroupBecomesCollapsedPromise = await chromeProxy.waitFor(
    "tabGroups.onUpdated",
    async (tabGroup) => {
      return tabGroup.id === activeTab.groupId && tabGroup.collapsed === true;
    }
  );
  await chromeProxy.tabGroups.update(nonActiveTab.groupId, { collapsed: false });
  await previousActiveTabGroupBecomesCollapsedPromise.waitForValidEventArgs;

  expect(true).toBe(true);
});
