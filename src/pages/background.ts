import BackgroundEvents from "../backgroundEvents";
import Database from "../database";
(async function main() {
  Database.initializeDatabaseConnection("model");
  BackgroundEvents.initialize();
})();
