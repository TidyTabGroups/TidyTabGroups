import { Page } from "@playwright/test";
import {
  ChromeTabGroupId,
  ChromeTabGroupWithId,
  ChromeTabId,
  ChromeTabWithId,
} from "../../Shared/Types/Types";
import Logger from "../../Shared/Logger";
import { ChromeProxy, ChromeProxyEventListener, ChromeProxyEventListenerArgs } from "../Types";
import { v4 as uuid } from "uuid";
import Misc from "../../Shared/Misc";

const logger = Logger.createLogger("chromeProxy");

export const api = {
  tabs: {
    get: ["tabs", "get"],
    create: ["tabs", "create"],
    update: ["tabs", "update"],
    group: ["tabs", "group"],
    query: ["tabs", "query"],
    move: ["tabs", "move"],
  },
  tabGroups: {
    get: ["tabGroups", "get"],
    update: ["tabGroups", "update"],
    TAB_GROUP_ID_NONE: ["tabGroups", "TAB_GROUP_ID_NONE"],
  },
};

export async function createChromeProxy(page: Page): Promise<ChromeProxy> {
  return {
    waitFor: (event, callback) => waitFor(page, event, callback),
    evaluateScript: (script, arg) => evaluateScript(page, script, arg),
    tabs: {
      get: async (tabId: ChromeTabId) => {
        return (await call(page, api.tabs.get, tabId)) as ChromeTabWithId;
      },
      create: async (options: chrome.tabs.CreateProperties) => {
        return (await call(page, api.tabs.create, options)) as ChromeTabWithId;
      },
      update: async (tabId: ChromeTabId, updateProperties: chrome.tabs.UpdateProperties) => {
        return (await call(page, api.tabs.update, tabId, updateProperties)) as ChromeTabWithId;
      },
      group: async (options: chrome.tabs.GroupOptions) => {
        return (await call(page, api.tabs.group, options)) as ChromeTabGroupId;
      },
      query: async (queryInfo: chrome.tabs.QueryInfo) => {
        return (await call(page, api.tabs.query, queryInfo)) as ChromeTabWithId[];
      },
      move: async (tabId: ChromeTabId, moveProperties: chrome.tabs.MoveProperties) => {
        return (await call(page, api.tabs.move, tabId, moveProperties)) as ChromeTabWithId;
      },
    },
    tabGroups: {
      get: async (groupId: number) => {
        return (await call(page, api.tabGroups.get, groupId)) as ChromeTabGroupWithId;
      },
      update: async (groupId: number, updateProperties: chrome.tabGroups.UpdateProperties) => {
        return (await call(
          page,
          api.tabGroups.update,
          groupId,
          updateProperties
        )) as ChromeTabGroupWithId;
      },
      TAB_GROUP_ID_NONE: (await get(page, api.tabGroups.TAB_GROUP_ID_NONE)) as ChromeTabGroupId,
    },
  };
}

async function evaluateScript(page: Page, script: string | ((...args: any) => any), arg?: any) {
  const myLogger = logger.createNestedLogger("evaluateScript");
  myLogger.log(`Evaluating script: ${script}`);

  return page.evaluate(script, arg);
}

async function waitFor<T extends ChromeProxyEventListener>(
  page: Page,
  event: T,
  callback: (...data: ChromeProxyEventListenerArgs<T>) => Promise<boolean>
) {
  const myLogger = logger.createNestedLogger("waitFor");

  const id = uuid();
  const idJson = JSON.stringify(id);
  myLogger.log(`Waiting for event: ${event}, id: ${id}`);

  // Add the Chrome event listener
  await page.evaluate(
    `
      const id = ${idJson};

      if (self.pendingEventArgs === undefined) {
        self.pendingEventArgs = {};
      }
      self.pendingEventArgs[id] = [];

      if (self.chromeListeners === undefined) {
        self.chromeListeners = {};
      }
      self.chromeListeners[id] = (...args) => {
        self.listeners[id]?.(...args);
        delete self.listeners[id];

        self.pendingEventArgs[id].push(args);
      }

      chrome.${event}.addListener(self.chromeListeners[id]);
    `
  );

  // Wait for the event to be triggered
  await waitForEventArgs(page);

  async function waitForEventArgs(page: Page) {
    const eventArgs = (await page.evaluate((id) => {
      return new Promise<any>((resolve) => {
        if ((self as any).pendingEventArgs[id].length > 0) {
          const pendingEventArgs = (self as any).pendingEventArgs[id].shift();
          resolve(pendingEventArgs);
        } else {
          if ((self as any).listeners === undefined) {
            (self as any).listeners = {};
          }
          (self as any).listeners[id] = (...args: any) => resolve(args);
        }
      });
    }, id)) as ChromeProxyEventListenerArgs<T>;

    if (await callback(...eventArgs)) {
      // Cleanup
      await page.evaluate(
        `
          const id = ${idJson};

          chrome.${event}.removeListener(self.chromeListeners[id]);
          delete self.chromeListeners[id];
          delete self.pendingEventArgs[id];
        `
      );
    } else {
      await waitForEventArgs(page);
    }
  }
}

async function call(page: Page, api: string[], ...args: any) {
  const myLogger = logger.createNestedLogger("call");

  const argsJson = JSON.stringify(args);
  myLogger.log(`chrome.${api.join(".")}.apply(null, ${argsJson});`);
  return await page.evaluate(`chrome.${api.join(".")}.apply(null, ${argsJson});`);
}

async function get(page: Page, api: string[]) {
  const myLogger = logger.createNestedLogger("get");
  myLogger.log(`chrome.${api.join(".")};`);

  return await page.evaluate(`chrome.${api.join(".")}`);
}
