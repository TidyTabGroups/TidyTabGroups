import { test, expect } from "./Fixtures/Fixture";
import { ChromeTabWithId } from "../Shared/Types/Types";
import Misc from "../Shared/Misc";

test("Created tab gets auto-grouped", async ({ chromeProxy }) => {
  const becomesGroupedPromise = chromeProxy.waitFor(
    "tabs.onUpdated",
    async (tabId, changeInfo, tab) => {
      return (
        tabId === createdTab.id &&
        changeInfo.groupId !== undefined &&
        changeInfo.groupId !== chromeProxy.tabGroups.TAB_GROUP_ID_NONE
      );
    }
  );

  const createdTab = await chromeProxy.tabs.create({ pinned: false });
  await becomesGroupedPromise;

  expect(true).toBe(true);
});

test("Created tab gets auto-grouped into new group", async ({ chromeProxy }) => {
  const activePinnedTab = await chromeProxy.tabs.create({ pinned: true, active: true });

  const becomesGroupedPromise = chromeProxy.waitFor(
    "tabs.onUpdated",
    async (tabId, changeInfo, tab) => {
      return (
        tabId === createdTab.id &&
        changeInfo.groupId !== undefined &&
        changeInfo.groupId !== chromeProxy.tabGroups.TAB_GROUP_ID_NONE
      );
    }
  );
  const createdTab = await chromeProxy.tabs.create({
    pinned: false,
    windowId: activePinnedTab.windowId,
  });
  await becomesGroupedPromise;

  expect(true).toBe(true);
});

test("Created tab gets auto-grouped into active tab group", async ({ chromeProxy }) => {
  const activeTab = await test.step("Create active tab group", async () => {
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
    return activeTab;
  });

  const becomesGroupedIntoActiveTabGroupPromise = chromeProxy.waitFor(
    "tabs.onUpdated",
    async (tabId, changeInfo, tab) => {
      return tabId === createdTab.id && changeInfo.groupId === activeTab.groupId;
    }
  );
  const createdTab = await chromeProxy.tabs.create({
    pinned: false,
    windowId: activeTab.windowId,
  });
  await becomesGroupedIntoActiveTabGroupPromise;

  expect(true).toBe(true);
});

test("Created pinned tab does NOT get auto-grouped", async ({ chromeProxy }) => {
  const newTab = await chromeProxy.tabs.create({ pinned: true });

  // Give some time for TTG to complete it's tab creation event logic
  // FIXME: What is a more deterministic way to wait for this?
  await Misc.waitMs(2000);

  const newTabUpToDate = (await chromeProxy.tabs.get(newTab.id)) as ChromeTabWithId;
  expect(newTabUpToDate.groupId).toBe(chromeProxy.tabGroups.TAB_GROUP_ID_NONE);
});

test("Created grouped tab does NOT get auto-grouped", async ({ chromeProxy }) => {
  // Create a tab and group it
  let createdTab = await chromeProxy.evaluateScript(async () => {
    // FIXME: Since it is not possible to create a tab and group it in the same action, there could
    // be a race condition where the app logic checks for the tab's group id before the tab is grouped.
    let createdTab = (await chrome.tabs.create({ pinned: false })) as ChromeTabWithId;
    await chrome.tabs.group({
      tabIds: [createdTab.id],
      createProperties: { windowId: createdTab.windowId },
    });
    createdTab = (await chrome.tabs.get(createdTab.id)) as ChromeTabWithId;
    return createdTab;
  });

  // Give some time for TTG to complete it's tab creation event logic
  // FIXME: What is a more deterministic way to wait for this?
  await Misc.waitMs(2000);

  const prevGroupId = createdTab.groupId;
  createdTab = await chromeProxy.tabs.get(createdTab.id);

  expect(createdTab.groupId).toBe(prevGroupId);
});
