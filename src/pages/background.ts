import ActiveWindowManager from "../activeWindowManager";
import Database from "../database";
import Logger from "../logger";
import { ActiveWindow } from "../model";
import * as Storage from "../storage";

const logger = Logger.getLogger("Background", { color: "pink" });

Database.initializeDatabaseConnection("model").catch(onError);
Storage.initialize().catch(onError);
ActiveWindowManager.initialize(onError);

chrome.action.onClicked.addListener(function (tab) {
  chrome.runtime.openOptionsPage();
});

async function onError() {
  logger.error("onError::An error occurred in the background page. Will try to recover...");
  chrome.runtime.reload();
}
