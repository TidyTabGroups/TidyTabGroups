import BackgroundEvents from "../backgroundEvents";
import Database from "../database";
(async function main() {
  chrome.runtime.onInstalled.addListener(BackgroundEvents.onInstalled);
  chrome.runtime.onMessage.addListener(BackgroundEvents.onMessage);
  chrome.tabGroups.onUpdated.addListener(BackgroundEvents.onTabGroupsUpdated);
  chrome.tabs.onActivated.addListener(BackgroundEvents.onTabActivated);
  chrome.windows.onCreated.addListener(BackgroundEvents.onWindowCreated);
  chrome.windows.onRemoved.addListener(BackgroundEvents.onWindowRemoved);
  chrome.tabs.onCreated.addListener(BackgroundEvents.onTabCreated);

  Database.initializeDatabaseConnection("model");
})();
