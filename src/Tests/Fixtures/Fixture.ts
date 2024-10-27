import { BrowserContext, chromium, test as base, Page } from "@playwright/test";
import path from "path";
import { ChromeProxy } from "../Types";
import { createChromeProxy } from "../ChromeProxy/ChromeProxy";

export const test = base.extend<{
  context: BrowserContext;
  extensionId: string;
  chromeProxy: ChromeProxy;
}>({
  context: async ({}, use) => {
    const pathToExtension = path.join(__dirname, "../../../dist");

    const context = await chromium.launchPersistentContext("", {
      headless: false,
      args: [
        `--disable-extensions-except=${pathToExtension}`,
        `--load-extension=${pathToExtension}`,
      ],
    });

    let [background] = context.serviceWorkers();
    if (!background) background = await context.waitForEvent("serviceworker");

    await use(context);
    await context.close();
  },
  chromeProxy: async ({ context }, use) => {
    let [background] = context.serviceWorkers();
    if (!background) background = await context.waitForEvent("serviceworker");

    const extensionId = background.url().split("/")[2];
    const testRunnerPageUrl = new URL(`chrome-extension://${extensionId}/test-runner-page.html`);
    const dummyPage = await context.newPage();
    await dummyPage.goto(testRunnerPageUrl.href);

    await dummyPage.evaluate(async () => {
      await chrome.windows.create({
        url: chrome.runtime.getURL("test-runner-page.html"),
        type: "popup",
        focused: false,
      });
    });

    await dummyPage.close();

    const existingTestRunnerPage = context
      .pages()
      .find((page) => page.url() === testRunnerPageUrl.href);

    let testRunnerPage: Page;
    if (existingTestRunnerPage) {
      testRunnerPage = existingTestRunnerPage;
    } else {
      console.warn("Test runner page not found, will wait for it to be created");
      testRunnerPage = await waitForPage(testRunnerPageUrl.href, context);
    }

    await testRunnerPage.evaluate(async () => {
      const { state } = await chrome.storage.local.get("state");
      if (state === "ready") {
        return;
      }

      return new Promise<void>((resolve) => {
        chrome.storage.local.onChanged.addListener((changes) => {
          if (changes.state?.newValue === "ready") {
            resolve();
          }
        });
      });
    });

    const chromeProxy = await createChromeProxy(testRunnerPage);
    await use(chromeProxy);
  },
});

export const expect = test.expect;

async function waitForPage(url: string, context: BrowserContext) {
  return await new Promise<Page>((resolve, reject) => {
    context.on("page", async (page) => {
      if (page.url() === url) {
        resolve(page);
      }
    });
  });
}
