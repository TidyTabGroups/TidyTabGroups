import * as Utils from "./utils";

(async function main() {
  chrome.runtime.onStartup.addListener(Utils.BackgroundEvents.onStartUp);
  chrome.tabGroups.onUpdated.addListener(Utils.BackgroundEvents.onTabGroupsUpdated);
  chrome.alarms.onAlarm.addListener(Utils.BackgroundEvents.onAlarm);
})();
