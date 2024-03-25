import BackgroundEvents from "../backgroundEvents";
import Database from "../database";
(async function main() {
  BackgroundEvents.initialize();
  Database.initializeDatabaseConnection("model");
})();
