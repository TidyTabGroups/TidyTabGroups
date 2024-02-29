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
