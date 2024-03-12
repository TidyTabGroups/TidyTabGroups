import BackgroundEvents from "../backgroundEvents";
import Database from "../database";
(async function main() {
  chrome.runtime.onInstalled.addListener(BackgroundEvents.onInstalled);
  chrome.runtime.onMessage.addListener(BackgroundEvents.onMessage);

  chrome.windows.onCreated.addListener(BackgroundEvents.onWindowCreated);
  chrome.windows.onRemoved.addListener(BackgroundEvents.onWindowRemoved);

  chrome.tabs.onCreated.addListener(BackgroundEvents.onTabCreated);
  chrome.tabs.onActivated.addListener(BackgroundEvents.onTabActivated);
  chrome.tabs.onUpdated.addListener(BackgroundEvents.onTabUpdated);
  chrome.tabs.onRemoved.addListener(BackgroundEvents.onTabRemoved);

  chrome.tabGroups.onUpdated.addListener(BackgroundEvents.onTabGroupsUpdated);
  chrome.tabGroups.onRemoved.addListener(BackgroundEvents.onTabGroupRemoved);

  Database.initializeDatabaseConnection("model");
})();
