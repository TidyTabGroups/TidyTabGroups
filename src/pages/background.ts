import BackgroundEvents from "../backgroundEvents";
import Database from "../database";
import Logger from "../logger";
import * as Storage from "../storage";

const logger = Logger.getLogger("Background", { color: "pink" });

Database.initializeDatabaseConnection("model");
BackgroundEvents.initialize(onError);
Storage.initialize();

chrome.action.onClicked.addListener(function (tab) {
  chrome.runtime.openOptionsPage();
});

async function onError() {
  logger.error("onError::An error occurred in the background page. Will try to recover...");
  chrome.runtime.reload();
}
