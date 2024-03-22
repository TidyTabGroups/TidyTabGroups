import { ChromeTabGroupId, ChromeTabGroupWithId, ChromeTabId, ChromeTabWithId, ChromeWindowId } from "../types/types";

export function onWindowError(windowId: ChromeWindowId) {
  // TODO: re-activate the window
}

// opens a dummy tab in windows that have a chrome://extensions/* tab open
export async function openDummyTab() {
  const lastFocusedWindow = await chrome.windows.getLastFocused();
  const [activeTab] = await chrome.tabs.query({ windowId: lastFocusedWindow.id, active: true });

  if (!activeTab || !activeTab.url) {
    return;
  }

  const activeTabUrl = new URL(activeTab.url);
  if (activeTabUrl.origin === "chrome://extensions") {
    chrome.tabs.create({ windowId: lastFocusedWindow.id, url: "dummy-page.html", active: false, index: activeTab.index + 1 });
  }
}

export async function getTabFromTabOrTabId(tabOrTabId: ChromeTabId | ChromeTabWithId) {
  const tab = typeof tabOrTabId === "number" ? ((await chrome.tabs.get(tabOrTabId)) as ChromeTabWithId) : tabOrTabId;
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
