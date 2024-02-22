import { IndexKey, IndexNames } from "idb";
import { ActiveWindowTab, ActiveWindow } from ".";
import * as Misc from "../misc";
import * as Storage from "../storage";
import {
  DataModel,
  ChromeTabGroupWithId,
  ChromeTabWithId,
  ActiveSpaceForChromeObjectFinder,
  ChromeWindowId,
  SpaceSyncData,
  SpaceSyncDataType,
  ChromeTabId,
} from "../types";
import { v4 as uuidv4 } from "uuid";
import Database from "../database";

export namespace ActiveWindowSpace {
  export function create(createProperties: DataModel.BaseActiveSpaceCreateProperties) {
    // TODO: validate createProperties
    const id = createProperties.id || uuidv4();
    return {
      ...createProperties,
      id,
    } as DataModel.ActiveSpace;
  }

  export function createFromExistingTabGroup(tabGroup: ChromeTabGroupWithId) {
    return ActiveWindowSpace.create({
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
    const activeWindow = await ActiveWindow.get(activeWindowId);
    const activeSpace = await ActiveWindowSpace.get(activeSpaceId);
    const activeTabs = await ActiveWindowTab.getAllFromIndex("activeSpaceId", activeSpaceId);

    if (!activeTabs) {
      throw new Error(`makePrimarySpace::activeSpace ${activeSpaceId} has no tabs`);
    }

    const { tabGroupInfo } = activeSpace;

    // 1. if there is more than one tab in the group, create a secondary tab group
    //  for every tab but the selected one and move it to the end
    // 2. move primary tab group to end position

    const nonSelectedTabs = activeTabs.filter((tab) => tab.id !== activeWindow.selectedTabId);
    if (nonSelectedTabs.length > 0) {
      const nonSelectedTabIds = nonSelectedTabs.map((tab) => tab.tabInfo.id);
      // step 1
      await createSecondaryTabGroup(activeWindow.id, nonSelectedTabIds);
    }

    // step 2
    await chrome.tabGroups.move(tabGroupInfo.id, { windowId: activeWindow.windowId, index: -1 });

    await ActiveWindow.update(activeWindowId, { primarySpaceId: activeSpaceId });
  }

  async function createSecondaryTabGroup(activeWindowId: string, tabIds: ChromeTabId[]) {
    const secondaryTabGroupId = await chrome.tabs.group({ tabIds });
    const secondaryTabGroup = await chrome.tabGroups.update(secondaryTabGroupId, {
      collapsed: true,
      title: Misc.SECONDARY_TAB_GROUP_TITLE_LEFT,
    });
    await chrome.tabGroups.move(secondaryTabGroup.id, {
      windowId: secondaryTabGroup.windowId,
      index: -1,
    });
    await ActiveWindow.update(activeWindowId, { secondaryTabGroup });
  }
}
