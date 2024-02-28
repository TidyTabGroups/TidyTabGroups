import BackgroundEvents from "../backgroundEvents";
import Database from "../database";
(async function main() {
  chrome.alarms.onAlarm.addListener(BackgroundEvents.onAlarm);
  chrome.runtime.onInstalled.addListener(BackgroundEvents.onInstalled);
  chrome.runtime.onMessage.addListener(BackgroundEvents.onMessage);
  chrome.tabGroups.onUpdated.addListener(BackgroundEvents.onTabGroupsUpdated);

  Database.initializeDatabaseConnection("model");
})();
