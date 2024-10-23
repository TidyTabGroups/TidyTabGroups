import Misc from "../Shared/Misc";
import { ChromeTabId } from "../Shared/Types/Types";
import { test, expect } from "./Fixtures/Fixture";

const DEFAULT_TEST_PAGE_URL = "file://" + __dirname + "/Resources/Pages/DefaultPage.html";

test("Focused tab group and tab get repositioned to end of tab bar", async ({
  chromeProxy,
  context,
}) => {
  const [targetPage, targetPageTab] =
    await test.step("Create target page and tab group", async () => {
      let targetPageTabId: ChromeTabId | undefined;
      const becomesLoadedPromise = chromeProxy.waitFor(
        "tabs.onUpdated",
        async (tabId, changeInfo, tab) => {
          if (changeInfo.status === "complete" && tab.url === DEFAULT_TEST_PAGE_URL) {
            targetPageTabId = tabId;
            return true;
          }
          return false;
        }
      );
      const becomesGroupedPromise = chromeProxy.waitFor("tabs.onUpdated", async (_, changeInfo) => {
        return (
          changeInfo.groupId !== undefined &&
          changeInfo.groupId !== chromeProxy.tabGroups.TAB_GROUP_ID_NONE
        );
      });
      const page = await context.newPage();
      await page.goto(DEFAULT_TEST_PAGE_URL);
      await becomesGroupedPromise;
      await becomesLoadedPromise;

      if (targetPageTabId === undefined) {
        throw new Error("targetPageTabId was not set");
      }

      const targetPageTab = await chromeProxy.tabs.get(targetPageTabId);
      // Title the tab group to make it easier to identify
      await chromeProxy.tabGroups.update(targetPageTab.groupId, { title: " * Target * " });

      return [page, targetPageTab];
    });

  await test.step("Create an active tab group with a tab positioned after the target tab", async () => {
    const becomesGroupedPromise = chromeProxy.waitFor(
      "tabs.onUpdated",
      async (tabId, changeInfo, tab) => {
        return (
          changeInfo.groupId !== undefined &&
          changeInfo.groupId !== chromeProxy.tabGroups.TAB_GROUP_ID_NONE
        );
      }
    );
    const tab = await chromeProxy.tabs.create({
      active: true,
      index: targetPageTab.index + 1,
      windowId: targetPageTab.windowId,
    });
    await becomesGroupedPromise;
    const tabGroup = await chromeProxy.tabs.group({
      tabIds: [tab.id],
      createProperties: { windowId: tab.windowId },
    });
    // Title the tab group to make it easier to identify
    await chromeProxy.tabGroups.update(tabGroup, { title: " * Tab Group After *" });
  });

  await test.step("Focus target tab group and wait for it and it's tab to be repositioned", async () => {
    const tabBecomesRepositionedPromise = chromeProxy.waitFor(
      "tabs.onMoved",
      async (tabId, moveInfo) => {
        if (tabId === targetPageTab.id) {
          const tabs = await chromeProxy.tabs.query({ windowId: targetPageTab.windowId });
          console.log(`moveInfo.toIndex: ${moveInfo.toIndex}, tabs.length: ${tabs.length}`);
          return moveInfo.toIndex === tabs.length - 1;
        }
        return false;
      }
    );

    const tabGroupBecomesRepositionedPromise = chromeProxy.waitFor(
      "tabGroups.onMoved",
      async (tabGroup) => {
        return true;
      }
    );

    await targetPage.bringToFront();
    await targetPage.evaluate(() => {
      // Need to give a height to the body to make it hoverable for Playwright
      document.body.style.height = "1px";
    });
    // WARNING: This does not work if your cursor is in the test page.
    await targetPage.hover("body");
    await tabBecomesRepositionedPromise;
    await tabGroupBecomesRepositionedPromise;
  });

  expect(true).toBe(true);
});
