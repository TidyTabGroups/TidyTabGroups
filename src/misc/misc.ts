import { getIfTabExists } from "../chromeWindowHelper/chromeWindowHelper";
import { ChromeTabGroupId, ChromeTabGroupWithId, ChromeTabId, ChromeTabWithId, ChromeWindowId, FixedPageType } from "../types/types";

export function onWindowError(windowId: ChromeWindowId) {
  // TODO: re-activate the window
}

export async function createFixedPage(type: FixedPageType, url: string) {
  const windows = await chrome.windows.getAll({ populate: true });

  if (type === "popupWindow") {
    const existingPopupWindow = windows.find((window) => window.tabs && window.tabs[0] && window.tabs[0].url === url);
    if (existingPopupWindow) {
      return;
    }

    await chrome.windows.create({
      url: url,
      type: "popup",
      focused: false,
    });
  } else {
    await Promise.all(
      windows.map(async (window) => {
        if (window.id === undefined) {
          return;
        }

        const pinned = type === "pinnedTab";
        const existingTabs = await chrome.tabs.query({ windowId: window.id, url, pinned });
        if (existingTabs.length > 0) {
          return;
        }

        await chrome.tabs.create({ url, windowId: window.id, pinned, active: false, index: 0 });
      })
    );
  }
}

export async function getTabFromTabOrTabId(tabOrTabId: ChromeTabId | ChromeTabWithId) {
  const tab = typeof tabOrTabId === "number" ? await getIfTabExists(tabOrTabId) : tabOrTabId;
  return tab;
}

export class NonRejectablePromise<T> {
  //FIXME: compiler cant see that these are indeed being set in the constructor. Issue could be because they are being set in a Promise callback
  // @ts-ignore
  private _resolve: (value: T | PromiseLike<T>) => void;
  private promise: Promise<T>;

  constructor() {
    this.promise = new Promise<T>((resolve) => {
      this._resolve = resolve;
    });
  }

  getPromise() {
    return this.promise;
  }

  resolve(value: T) {
    this._resolve(value);
  }
}

export function callAsync(fn: Function) {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve(fn());
    });
  });
}

export function waitMs(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function lazyCall<T>(fn: () => Promise<T>) {
  let value: T;
  let hasValue = false;

  return async function () {
    if (!hasValue) {
      value = await fn();
      hasValue = true;
    }

    return value;
  };
}

const awokenTime = new Date();
export function serviceWorkerJustWokeUp() {
  return new Date().getTime() - awokenTime.getTime() < 500;
}

export const DEFAULT_TAB_GROUP_TITLE = "New Group";

export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") {
    return error.message;
  }
  return "An unknown error occurred";
}
