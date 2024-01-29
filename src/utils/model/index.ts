import { TidyTabs, ChromeTabGroupWithId, ChromeTabWithId } from "../../types/";
import { TidyTabsSpaceModel } from "../../model";
import * as Utils from "../misc";
import * as TidyTabsShapeValidator from "../TidyTabsShapeValidator";

export async function useOrGetDataModel(dataModel?: TidyTabs.DataModel) {
  function isDataModel(dataModel?: TidyTabs.DataModel) {
    // TODO: check the type and shape?
    return !!dataModel;
  }

  return isDataModel(dataModel) ? dataModel! : await getDataModel();
}

export async function syncActiveSpaceWithWindow<T extends TidyTabs.SpaceSyncDataType>(
  syncData: TidyTabs.SpaceSyncData<T>
) {
  const { windowId, activeSpace, type, data } = syncData;

  const newActiveSpace = { ...activeSpace };

  const { activeData } = activeSpace;
  if (!activeData) {
    throw new Error(`syncActiveSpaceWithWindow::activeSpace ${activeSpace.id} has no activeData`);
  }

  if (activeData.windowId !== windowId) {
    throw new Error(
      `syncActiveSpaceWithWindow::activeSpace ${activeSpace.id} has activeData for window ${activeData.windowId} but syncData is for window ${windowId}`
    );
  }

  if (type === "tab") {
    const { activeTab } = activeData;
    const newActiveTab = data as ChromeTabWithId;
    if (!activeTab) {
      throw new Error(`syncActiveSpaceWithWindow::activeSpace ${activeSpace.id} has no activeTab`);
    }

    if (activeTab.id !== newActiveTab.id) {
      throw new Error(
        `syncActiveSpaceWithWindow::activeSpace ${activeSpace.id} has activeTab ${activeTab.id} but syncData is for tab ${newActiveTab.id}`
      );
    }

    newActiveSpace.activeData!.activeTab = newActiveTab;
  } else if (type === "tabGroup") {
    const { primaryTabGroup, secondaryTabGroup } = activeData;
    const newTabGroup = data as ChromeTabGroupWithId;
    if (primaryTabGroup.id === newTabGroup.id) {
      newActiveSpace.activeData!.primaryTabGroup = newTabGroup;
    } else if (secondaryTabGroup.id === data.id) {
      newActiveSpace.activeData!.secondaryTabGroup = newTabGroup;
    } else {
      throw new Error(`syncActiveSpaceWithWindow::activeSpace ${activeSpace.id} has no tab group with id ${data.id}`);
    }
  } else {
    throw new Error(`syncActiveSpaceWithWindow::syncData has invalid type ${type}`);
  }

  try {
    await TidyTabsSpaceModel.update(activeSpace.id, newActiveSpace);
  } catch (error) {
    const errorMessage = `syncActiveSpaceWithWindow::unable to sync active space ${activeSpace.id} with window ${windowId}. Error: ${error}`;
    console.error(errorMessage);
    throw new Error(errorMessage);
  }
}

export async function initializeDataModel() {
  try {
    const dataModel = {
      activeSpaces: await getExistingActiveSpaces(),
    } as TidyTabs.DataModel;

    await chrome.storage.local.set({ dataModel });

    return dataModel;
  } catch (error) {
    const errorMessage = `
        DataModel::initialize::Could not initialize data model. 
        Error: ${error}
      `;
    console.error(errorMessage);
    throw new Error(errorMessage);
  }
}

export async function getDataModel() {
  try {
    const { dataModel } = (await chrome.storage.local.get("dataModel")) as { dataModel?: TidyTabs.DataModel };
    if (!dataModel) {
      throw new Error("DataModel::get::dataModel object not found in storage");
    }
    return dataModel;
  } catch (error) {
    const errorMessage = `
        DataModel::get::Could not get data model. 
        Error: ${error}
      `;
    console.error(errorMessage);
    throw new Error(errorMessage);
  }
}

export async function getExistingActiveSpaces() {
  try {
    const windows = Utils.getWindowsWithIds(await chrome.windows.getAll());
    const activeSpaces: Array<TidyTabs.Space> = [];
    await Promise.all(
      windows.map(async (window) => {
        if (await TidyTabsShapeValidator.validateWindow(window.id)) {
          const activeSpace = await TidyTabsSpaceModel.createWithExistingWindow(window.id);
          activeSpaces.push(activeSpace);
        } else {
          console.warn(`DataModel::getExistingActiveSpaces::Window ${window.id} is not in tidy tabs space shape`);
        }
      })
    );
    return activeSpaces;
  } catch (error) {
    const errorMessage = `
        DataModel::getExistingActiveSpaces::Could not get existing active spaces. 
        Error: ${error}
      `;
    console.error(errorMessage);
    throw new Error(errorMessage);
  }
}
