import BackgroundEvents from "../backgroundEvents";
import Database from "../database";
import Logger from "../logger";

const logger = Logger.getLogger("Background", { color: "pink" });

(async function main() {
  BackgroundEvents.initialize(onError);
  try {
    await Database.initializeDatabaseConnection("model");
  } catch (error) {
    logger.error("main::error initializing database", error);
    onError();
  }
})();

async function onError() {
  logger.error("onError::An error occurred in the background page. Will try to recover...");
  try {
    await Database.deleteDatabase("model");
    chrome.runtime.reload();
  } catch (error) {
    // TODO: notify the user that the extension is in a bad state, and to trouble shoot:
    // 1. re-install the extension
    // 2. restart browser
    logger.error("onError::absolute error :( Tried everything...", error);
  }
}
