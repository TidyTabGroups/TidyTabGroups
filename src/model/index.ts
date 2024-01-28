import { v4 as uuidv4 } from "uuid";
import { ChromeWindowId, TidyTabs } from "../types";
import * as Utils from "../utils";

export class DataModelManager {
  static async initialize() {
    try {
      const dataModel = {
        activeSpaces: await DataModelManager.getExistingActiveSpaces(),
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

  static async get() {
    try {
      const { dataModel } = (await chrome.storage.local.get("dataModel")) as { dataModel: TidyTabs.DataModel };
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

  static async getExistingActiveSpaces() {
    try {
      const windows = Utils.getWindowsWithIds(await chrome.windows.getAll());
      const activeSpaces: Array<TidyTabs.Space> = [];
      await Promise.all(
        windows.map(async (window) => {
          if (await Utils.TidyTabsShapeValidator.validateWindow(window.id)) {
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
}

export class TidyTabsSpaceModel {
  static async createWithExistingWindow(windowId: ChromeWindowId) {
    try {
      const {
        activeTab,
        primaryTab: _primaryTab,
        secondaryTabs: _secondaryTabs,
        primaryTabGroup,
        secondaryTabGroup,
      } = await Utils.extractActiveDataFromWindowInTidyTabsSpaceShape(windowId);

      const primaryTab = TidyTabsTabModel.create({
        activeData: { tabId: _primaryTab.id },
      });

      const secondaryTabs = _secondaryTabs.map((tab) =>
        TidyTabsTabModel.create({
          activeData: { tabId: tab.id },
        })
      );

      return TidyTabsSpaceModel.create({
        primaryTab,
        secondaryTabs,
        activeData: {
          windowId,
          activeTab,
          secondaryTabGroup,
          primaryTabGroup,
        },
      });
    } catch (error) {
      const errorMessage = `
        TidyTabsSpaceModel::createWithExistingWindow::Could not create tidy tabs space from existing window: ${windowId}. 
        Error: ${error}
      `;
      console.error(errorMessage);
      throw new Error(errorMessage);
    }
  }

  static async createWithNewWindow(
    primaryTab: TidyTabs.TabCreateProperties,
    secondaryTabs: TidyTabs.TabCreateProperties[]
  ) {
    // const newWindow = await chrome.windows.create({ focused: true });
    // if (!newWindow.id) {
    //   const errorMessage = "New window has no id";
    //   console.error(`openTidyTabsStarterWindow::Error: ${errorMessage}`);
    //   throw new Error(errorMessage);
    // }
    // const newWindowIdleTab = await chrome.tabs.create({ windowId: newWindow.id });
    // const newWindowActiveTab = await chrome.tabs.create({ windowId: newWindow.id, active: true });
    // if (!newWindowActiveTab.id || !newWindowIdleTab.id) {
    //   const errorMessage = `New window tabs have no id. Window id: ${newWindow.id}`;
    //   console.error(`openTidyTabsStarterWindow::Error: ${errorMessage}`);
    //   throw new Error(errorMessage);
    // }
    // const secondaryTabGroupId = await Utils.createTabGroup([newWindowIdleTab.id], {
    //   windowId: newWindow.id,
    //   title: Utils.SECONDARY_TAB_GROUP_TITLE,
    // });
    // const primaryTabGroupId = await Utils.createTabGroup([newWindowActiveTab.id], {
    //   windowId: newWindow.id,
    //   title: "Tidy Tabs Intro",
    // });
    // const space = TidyTabsSpaceModel.create(
    //   secondaryTabGroupId,
    //   primaryTabGroupId,
    //   TidyTabsTabModel.create(newWindowActiveTab.id, primaryTabGroupId),
    //   []
    // );
    // return {
    //   id: uuidv4(),
    //   windowId: newWindow.id,
    //   activeSpace: space,
    // } as TidyTabsWindow;
  }

  static async create(createProperties: TidyTabs.SpaceCreateProperties) {
    // TODO: validate createProperties
    const id = createProperties.id || uuidv4();
    return {
      ...createProperties,
      id,
    } as TidyTabs.Space;
  }
}

export class TidyTabsTabModel {
  static create(createProperties: TidyTabs.TabCreateProperties) {
    // TODO: validate createProperties
    const id = createProperties.id || uuidv4();
    return {
      ...createProperties,
      id,
    } as TidyTabs.Tab;
  }
}
