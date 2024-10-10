import ChromeWindowMethods from "../ChromeWindowMethods";
import {
  ChromeTabGroupWithId,
  ChromeTabId,
  ChromeTabWithId,
  ChromeWindowId,
  FixedPageType,
  ExcludeUndefined,
} from "../Types/Types";
import Storage from "../Storage";

export function tabGroupEquals(
  tabGroup: ChromeTabGroupWithId,
  tabGroupToCompare: ChromeTabGroupWithId
) {
  const keys = Object.keys(tabGroupToCompare) as (keyof chrome.tabGroups.TabGroup)[];
  if (
    keys.length !== Object.keys(tabGroup).length ||
    keys.find((key) => tabGroupToCompare[key] !== tabGroup[key])
  ) {
    return false;
  }

  return true;
}

export function isTabGroupTitleEmpty(title: chrome.tabGroups.TabGroup["title"]) {
  return title === undefined || title === "";
}

export async function getTabFromTabOrTabId(tabOrTabId: ChromeTabId | ChromeTabWithId) {
  const tab =
    typeof tabOrTabId === "number"
      ? await ChromeWindowMethods.getIfTabExists(tabOrTabId)
      : tabOrTabId;
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
  if (
    error &&
    typeof error === "object" &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return error.message;
  }
  return "An unknown error occurred";
}

export function createDummyFixedPage<T extends FixedPageType>(
  type: T,
  windowId?: T extends "pinnedTab" | "tab" ? ChromeWindowId : undefined
) {
  return ChromeWindowMethods.createFixedPage<T>(
    type,
    chrome.runtime.getURL("dummy-page.html"),
    windowId
  );
}

export function createOptionsFixedPage<T extends FixedPageType>(
  type: T,
  windowId?: T extends "pinnedTab" | "tab" ? ChromeWindowId : undefined
) {
  return ChromeWindowMethods.createFixedPage<T>(
    type,
    chrome.runtime.getURL("options.html"),
    windowId
  );
}

export function forEachNestedFrame(callback: (frame: Window) => void) {
  function recurseFrames(context: Window) {
    for (var i = 0; i < context.frames.length; i++) {
      callback(context.frames[i]);
      recurseFrames(context.frames[i]);
    }
  }
  recurseFrames(window);
}

export function getNestedFrames() {
  var allFrames: Window[] = [];
  function recurseFrames(context: Window) {
    for (var i = 0; i < context.frames.length; i++) {
      allFrames.push(context.frames[i]);
      recurseFrames(context.frames[i]);
    }
  }
  recurseFrames(window);
  return allFrames;
}
