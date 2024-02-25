import { IndexKey, IndexNames } from "idb";
import { ActiveWindowTab, ActiveWindow } from ".";
import { DataModel, ChromeTabGroupWithId } from "../types";
import { v4 as uuidv4 } from "uuid";
import Database from "../database";

export namespace ActiveWindowSpace {
  export function create(createProperties: DataModel.ActiveSpaceCreateProperties): DataModel.ActiveSpace {
    // TODO: validate createProperties
    const id = createProperties.id || uuidv4();
    return {
      ...createProperties,
      id,
    };
  }

  export function createFromExistingTabGroup(
    activeWindowId: DataModel.ActiveSpaceCreateProperties["activeWindowId"],
    tabGroup: ChromeTabGroupWithId
  ) {
    return ActiveWindowSpace.create({
      activeWindowId,
      tabGroupInfo: {
        id: tabGroup.id,
        title: tabGroup.title,
        color: tabGroup.color,
        collapsed: tabGroup.collapsed,
      },
    });
  }

  export async function get(spaceId: string) {
    const modelDB = await Database.getDBConnection<DataModel.ModelDB>("model");
    const activeSpace = await modelDB.get("activeSpaces", spaceId);
    if (!activeSpace) {
      throw new Error(`TidyTabsSpaceModel::get::Could not find active space with id ${spaceId}`);
    }
    return activeSpace;
  }

  export async function getFromIndex<IndexName extends IndexNames<DataModel.ModelDB, "activeSpaces">>(
    index: IndexName,
    query: IndexKey<DataModel.ModelDB, "activeSpaces", IndexName> | IDBKeyRange
  ) {
    const modelDB = await Database.getDBConnection<DataModel.ModelDB>("model");
    return await modelDB.getFromIndex<"activeSpaces", IndexName>("activeSpaces", index, query);
  }

  export async function getAllFromIndex<IndexName extends IndexNames<DataModel.ModelDB, "activeSpaces">>(
    index: IndexName,
    query: IndexKey<DataModel.ModelDB, "activeSpaces", IndexName> | IDBKeyRange
  ) {
    const modelDB = await Database.getDBConnection<DataModel.ModelDB>("model");
    return await modelDB.getAllFromIndex<"activeSpaces", IndexName>("activeSpaces", index, query);
  }

  export async function update(id: string, updateProperties: Partial<DataModel.ActiveSpace>) {
    const modelDB = await Database.getDBConnection<DataModel.ModelDB>("model");
    const activeSpace = await get(id);
    await modelDB.put("activeSpaces", { ...activeSpace, ...updateProperties });
  }

  export async function makePrimarySpace(activeWindowId: string, activeSpaceId: string) {
    const activeSpace = await ActiveWindowSpace.get(activeSpaceId);
    const activeTabs = await ActiveWindowTab.getAllFromIndex("activeSpaceId", activeSpaceId);
    if (!activeTabs) {
      throw new Error(`makePrimarySpace::activeSpace ${activeSpaceId} has no tabs`);
    }
    const { tabGroupInfo } = activeSpace;
    await chrome.tabGroups.move(tabGroupInfo.id, { index: -1 });
    await ActiveWindow.update(activeWindowId, { primarySpaceId: activeSpaceId });
  }
}
