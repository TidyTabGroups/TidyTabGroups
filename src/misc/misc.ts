import ChromeWindowHelper from "../chromeWindowHelper";
import { getIfTabExists } from "../chromeWindowHelper/chromeWindowHelper";
import {
  ChromeTabGroupId,
  ChromeTabGroupWithId,
  ChromeTabId,
  ChromeTabWithId,
  ChromeWindowId,
  ChromeWindowWithId,
  FixedPageType,
} from "../types/types";

export function onWindowError(windowId: ChromeWindowId) {
  // TODO: re-activate the window
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

export function createDummyFixedPage<T extends FixedPageType>(type: T, windowId?: T extends "pinnedTab" | "tab" ? ChromeWindowId : undefined) {
  return ChromeWindowHelper.createFixedPage<T>(type, chrome.runtime.getURL("dummy-page.html"), windowId);
}

export function createOptionsFixedPage<T extends FixedPageType>(type: T, windowId?: T extends "pinnedTab" | "tab" ? ChromeWindowId : undefined) {
  return ChromeWindowHelper.createFixedPage<T>(type, chrome.runtime.getURL("options.html"), windowId);
}
