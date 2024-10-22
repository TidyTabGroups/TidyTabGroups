import {
  ChromeTabGroupId,
  ChromeTabGroupWithId,
  ChromeTabId,
  ChromeTabWithId,
} from "../Shared/Types/Types";

export type ChromeProxyEventListener = "tabs.onUpdated" | "tabs.onMoved" | "tabGroups.onUpdated";
export type ChromeProxyEventListenerArgs<T extends ChromeProxyEventListener> =
  T extends "tabs.onUpdated"
    ? [ChromeTabId, chrome.tabs.TabChangeInfo, chrome.tabs.Tab]
    : T extends "tabs.onMoved"
    ? [ChromeTabId, chrome.tabs.TabMoveInfo]
    : T extends "tabGroups.onUpdated"
    ? [chrome.tabGroups.TabGroup]
    : never;

export interface ChromeProxy {
  evaluateScript: (script: string | ((...args: any) => any), arg?: any) => Promise<any>;
  waitFor: <T extends ChromeProxyEventListener>(
    event: T,
    callback: (...data: ChromeProxyEventListenerArgs<T>) => Promise<boolean>
  ) => Promise<void>;
  tabs: {
    get: (tabId: ChromeTabId) => Promise<ChromeTabWithId>;
    create: (options: chrome.tabs.CreateProperties) => Promise<ChromeTabWithId>;
    update: (
      tabId: ChromeTabId,
      updateProperties: chrome.tabs.UpdateProperties
    ) => Promise<ChromeTabWithId>;
    group: (options: chrome.tabs.GroupOptions) => Promise<ChromeTabGroupId>;
    query: (queryInfo: chrome.tabs.QueryInfo) => Promise<ChromeTabWithId[]>;
    move: (
      tabId: ChromeTabId,
      moveProperties: chrome.tabs.MoveProperties
    ) => Promise<ChromeTabWithId>;
  };
  tabGroups: {
    get: (groupId: number) => Promise<ChromeTabGroupWithId>;
    update: (
      groupId: number,
      updateProperties: chrome.tabGroups.UpdateProperties
    ) => Promise<ChromeTabGroupWithId>;
    TAB_GROUP_ID_NONE: ChromeTabGroupId;
  };
}
