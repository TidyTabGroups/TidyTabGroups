import { v4 as uuidv4 } from "uuid";
import { ChromeWindowId, TidyTabs } from "../../types";
import * as Utils from "../../utils";
import { TidyTabsTabModel } from "../Tab";

export class TidyTabsSpaceModel {
  static async createWithExistingWindow(windowId: ChromeWindowId) {
    try {
      const {
        activeTab,
        primaryTab: _primaryTab,
        secondaryTabs: _secondaryTabs,
        primaryTabGroup,
        secondaryTabGroup,
      } = await Utils.TidyTabsShapeValidator.extractActiveDataFromWindowInTidyTabsSpaceShape(windowId);

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

  static async update(id: string, updateProperties: Partial<TidyTabs.Space>, dataModel?: TidyTabs.DataModel) {
    dataModel = await Utils.DataModel.useOrGetDataModel(dataModel);
    const activeSpaces = dataModel.activeSpaces;
    let updatedSpace: TidyTabs.Space | undefined;
    const newDataModel = {
      ...dataModel,
      activeSpaces: activeSpaces.map((space) => {
        if (space.id === id) {
          updatedSpace = {
            ...space,
            ...updateProperties,
          };
          return updatedSpace;
        }
        return space;
      }),
    };

    if (!updatedSpace) {
      throw new Error(`TidyTabsSpaceModel::update::Could not find space with id ${id}`);
    }

    await chrome.storage.local.set({ dataModel: newDataModel });
    return updatedSpace;
  }
}
