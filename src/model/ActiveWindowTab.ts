import { IndexKey, IndexNames } from "idb";
import { DataModel, ChromeTabWithId } from "../types";
import { v4 as uuidv4 } from "uuid";
import Database from "../database";

export namespace ActiveWindowTab {
  export function create(createProperties: DataModel.BaseActiveTabCreateProperties) {
    // TODO: validate createProperties
    const id = createProperties.id || uuidv4();
    return {
      ...createProperties,
      id,
    } as DataModel.ActiveTab;
  }

  export function createFromExistingTab(tab: ChromeTabWithId) {
    return create({
      tabInfo: {
        id: tab.id,
        url: tab.url,
        title: tab.title,
      },
    });
  }

  export async function get(id: string) {
    const modelDB = await Database.getDBConnection<DataModel.ModelDB>("model");
    const activeTab = await modelDB.get("activeTabs", id);
    if (!activeTab) {
      throw new Error(`TidyTabsTabModel::get::Could not find active tab with id ${id}`);
    }
    return activeTab;
  }

  export async function getFromIndex<IndexName extends IndexNames<DataModel.ModelDB, "activeTabs">>(
    index: IndexName,
    query: IndexKey<DataModel.ModelDB, "activeTabs", IndexName> | IDBKeyRange
  ) {
    const modelDB = await Database.getDBConnection<DataModel.ModelDB>("model");
    return await modelDB.getFromIndex<"activeTabs", IndexName>("activeTabs", index, query);
  }

  export async function getAllFromIndex<IndexName extends IndexNames<DataModel.ModelDB, "activeTabs">>(
    index: IndexName,
    query: IndexKey<DataModel.ModelDB, "activeTabs", IndexName> | IDBKeyRange
  ) {
    const modelDB = await Database.getDBConnection<DataModel.ModelDB>("model");
    return await modelDB.getAllFromIndex<"activeTabs", IndexName>("activeTabs", index, query);
  }

  export async function update(id: string, updateProperties: Partial<DataModel.ActiveTab>) {
    const modelDB = await Database.getDBConnection<DataModel.ModelDB>("model");
    const activeTab = await get(id);
    await modelDB.put("activeTabs", { ...activeTab, ...updateProperties });
  }
}
