import * as BackgroundEvents from "./backgroundEvents";
(async function main() {
  chrome.alarms.onAlarm.addListener(BackgroundEvents.onAlarm);
  chrome.action.onClicked.addListener(BackgroundEvents.onActionClicked);
  chrome.runtime.onInstalled.addListener(BackgroundEvents.onInstalled);
  chrome.runtime.onStartup.addListener(BackgroundEvents.onStartUp);
  chrome.tabGroups.onUpdated.addListener(BackgroundEvents.onTabGroupsUpdated);
})();
