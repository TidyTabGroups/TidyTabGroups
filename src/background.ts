import * as Utils from "./utils";

(async function main() {
  chrome.alarms.onAlarm.addListener(Utils.BackgroundEvents.onAlarm);
  chrome.action.onClicked.addListener(Utils.BackgroundEvents.onActionClicked);
  chrome.runtime.onInstalled.addListener(Utils.BackgroundEvents.onInstalled);
  chrome.runtime.onStartup.addListener(Utils.BackgroundEvents.onStartUp);
  chrome.tabGroups.onUpdated.addListener(Utils.BackgroundEvents.onTabGroupsUpdated);
})();
