import { Page } from "@playwright/test";
import {
  ChromeTabGroupId,
  ChromeTabGroupWithId,
  ChromeTabId,
  ChromeTabWithId,
} from "../../Shared/Types/Types";
import Logger from "../../Shared/Logger";
import Misc from "../../Shared/Misc";

const logger = Logger.createLogger("chromeProxy");

type ChromeProxyEventListener = "tabs.onUpdated" | "tabGroups.onUpdated";
type ChromeProxyEventListenerArgs<T extends ChromeProxyEventListener> = T extends "tabs.onUpdated"
  ? [ChromeTabId, chrome.tabs.TabChangeInfo, chrome.tabs.Tab]
  : [chrome.tabGroups.TabGroup];

export const api = {
  tabs: {
    get: ["tabs", "get"],
    create: ["tabs", "create"],
    update: ["tabs", "update"],
    group: ["tabs", "group"],
  },
  tabGroups: {
    get: ["tabGroups", "get"],
    update: ["tabGroups", "update"],
    TAB_GROUP_ID_NONE: ["tabGroups", "TAB_GROUP_ID_NONE"],
  },
};

export default class ChromeProxy {
  constructor(page: Page) {
    this.page = page;
  }

  private isLoaded = false;
  private page: Page;

  public tabs: {
    get: (tabId: ChromeTabId) => Promise<ChromeTabWithId>;
    create: (options: chrome.tabs.CreateProperties) => Promise<ChromeTabWithId>;
    update: (
      tabId: ChromeTabId,
      updateProperties: chrome.tabs.UpdateProperties
    ) => Promise<ChromeTabWithId>;
    group: (options: chrome.tabs.GroupOptions) => Promise<ChromeTabGroupId>;
  } = {} as any;

  public tabGroups: {
    get: (groupId: number) => Promise<ChromeTabGroupWithId>;
    update: (
      groupId: number,
      updateProperties: chrome.tabGroups.UpdateProperties
    ) => Promise<ChromeTabGroupWithId>;
    TAB_GROUP_ID_NONE: ChromeTabGroupId;
  } = {} as any;

  public async loadAPI() {
    this.tabs = {
      get: async (tabId: ChromeTabId) => {
        return (await this.call(api.tabs.get, tabId)) as ChromeTabWithId;
      },
      create: async (options: chrome.tabs.CreateProperties) => {
        return (await this.call(api.tabs.create, options)) as ChromeTabWithId;
      },
      update: async (tabId: ChromeTabId, updateProperties: chrome.tabs.UpdateProperties) => {
        return (await this.call(api.tabs.update, tabId, updateProperties)) as ChromeTabWithId;
      },
      group: async (options: chrome.tabs.GroupOptions) => {
        return (await this.call(api.tabs.group, options)) as ChromeTabGroupId;
      },
    };

    this.tabGroups = {
      get: async (groupId: number) => {
        return (await this.call(api.tabGroups.get, groupId)) as ChromeTabGroupWithId;
      },
      update: async (groupId: number, updateProperties: chrome.tabGroups.UpdateProperties) => {
        return (await this.call(
          api.tabGroups.update,
          groupId,
          updateProperties
        )) as ChromeTabGroupWithId;
      },
      TAB_GROUP_ID_NONE: (await this._get(api.tabGroups.TAB_GROUP_ID_NONE)) as ChromeTabGroupId,
    };

    this.isLoaded = true;
  }

  public evaluateScript(script: string | ((...args: any) => any), arg?: any) {
    const myLogger = logger.createNestedLogger("evaluateScript");
    if (!this.isLoaded) {
      throw new Error(myLogger.getPrefixedMessage("API not loaded"));
    }

    myLogger.log(`Evaluating script: ${script}`);
    return this.page.evaluate(script, arg);
  }

  public async waitFor<T extends ChromeProxyEventListener>(
    event: T,
    callback: (...data: ChromeProxyEventListenerArgs<T>) => Promise<boolean>
  ) {
    const myLogger = logger.createNestedLogger("waitFor");
    if (!this.isLoaded) {
      throw new Error(myLogger.getPrefixedMessage("API not loaded"));
    }

    const id = new Date().getTime();
    myLogger.log(`Waiting for event: ${event}, id: ${id}`);

    // Add the Chrome event listener
    await this.page.evaluate(
      `
        const id = ${id};

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
    await waitForEventArgs(this.page);

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
            const id = ${id};

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

  private async call(api: string[], ...args: any) {
    const myLogger = logger.createNestedLogger("call");

    const argsJson = JSON.stringify(args);
    myLogger.log(`chrome.${api.join(".")}.apply(null, ${argsJson});`);
    return await this.page.evaluate(`chrome.${api.join(".")}.apply(null, ${argsJson});`);
  }

  private async _get(api: string[]) {
    return await this.page.evaluate(`chrome.${api.join(".")}`);
  }

  private async get(api: string[]) {
    const myLogger = logger.createNestedLogger("get");
    if (!this.isLoaded) {
      throw new Error(myLogger.getPrefixedMessage("API not loaded"));
    }

    myLogger.log(`chrome.${api.join(".")}.`);

    return await this._get(api);
  }
}
