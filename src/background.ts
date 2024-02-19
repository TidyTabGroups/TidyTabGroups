import * as BackgroundEvents from "./backgroundEvents";
import Database from "./database";
(async function main() {
  chrome.alarms.onAlarm.addListener(BackgroundEvents.onAlarm);
  chrome.action.onClicked.addListener(BackgroundEvents.onActionClicked);
  chrome.runtime.onInstalled.addListener(BackgroundEvents.onInstalled);
  chrome.runtime.onStartup.addListener(BackgroundEvents.onStartUp);
  chrome.tabGroups.onUpdated.addListener(BackgroundEvents.onTabGroupsUpdated);

  Database.initializeDatabase("model");
})();
