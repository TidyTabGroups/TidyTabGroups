import BackgroundEvents from "./backgroundEvents";
import Database from "./database";
(async function main() {
  chrome.alarms.onAlarm.addListener(BackgroundEvents.onAlarm);
  chrome.runtime.onInstalled.addListener(BackgroundEvents.onInstalled);
  chrome.tabGroups.onUpdated.addListener(BackgroundEvents.onTabGroupsUpdated);

  Database.initializeDatabaseConnection("model");
})();
