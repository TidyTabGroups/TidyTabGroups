import BackgroundEvents from "../backgroundEvents";
import Database from "../database";
import Logger from "../logger";

const logger = Logger.getLogger("Background", { color: "pink" });

(async function main() {
  Database.initializeDatabaseConnection("model");
  BackgroundEvents.initialize(onError);
})();

async function onError() {
  logger.error("onError::An error occurred in the background page. Will try to recover...");
  chrome.runtime.reload();
}
