import { ActiveWindowTab, ActiveWindow } from ".";
import * as Misc from "../misc";
import {
  DataModel,
  ChromeTabGroupWithId,
  ChromeTabWithId,
  ActiveSpaceForChromeObjectFinder,
  ChromeWindowId,
  SpaceSyncData,
  SpaceSyncDataType,
} from "../types";
import { v4 as uuidv4 } from "uuid";

export namespace ActiveWindowSpace {
  export function create(createProperties: DataModel.ActiveSpaceCreateProperties) {
    // TODO: validate createProperties
    const id = createProperties.id || uuidv4();
    return {
      ...createProperties,
      id,
    } as DataModel.ActiveSpace;
  }

  export function createFromExistingTabGroup(
    tabGroup: ChromeTabGroupWithId,
    tabsInGroup: Array<ChromeTabWithId>
  ) {
    const activeTabs = tabsInGroup.map((tab) => ActiveWindowTab.createFromExistingTab(tab));
    return ActiveWindowSpace.create({
      windowId: tabGroup.windowId,
      tabGroupInfo: {
        id: tabGroup.id,
        title: tabGroup.title,
        color: tabGroup.color,
        collapsed: tabGroup.collapsed,
      },
      tabs: activeTabs,
    });
  }

  export async function get(activeWindowId: string, spaceId: string) {
    const activeWindow = await ActiveWindow.get(activeWindowId);
    const space = activeWindow.spaces.find((space) => space.id === spaceId);

    if (!space) {
      const errorMessage = `getSpace: No space found with id: ${spaceId}`;
      console.error(errorMessage);
      throw new Error(errorMessage);
    }

    return space;
  }

  export async function update(
    id: string,
    activeWindowId: string,
    updateProperties: Partial<DataModel.ActiveSpace>
  ) {
    try {
      const activeWindows = await ActiveWindow.getAll();
      for (let activeWindow of activeWindows) {
        if (activeWindow.id !== activeWindowId) {
          continue;
        }

        let updatedSpace: DataModel.ActiveSpace | undefined;
        const updatedSpaces = activeWindow.spaces.map((space) => {
          if (space.id === id) {
            updatedSpace = {
              ...space,
              ...updateProperties,
            };
            return updatedSpace;
          }
          return space;
        });

        if (!updatedSpace) {
          const errorMessage = `TidyTabsSpaceModel::update::Could not find space with id ${id}`;
          console.error(errorMessage);
          throw new Error(errorMessage);
        }

        await ActiveWindow.update(activeWindowId, {
          spaces: updatedSpaces,
        });
        return updatedSpace;
      }
    } catch (error) {
      const errorMessage = `TidyTabsSpaceModel::update::Error: ${error}`;
      console.error(errorMessage);
      throw new Error(errorMessage);
    }
  }

  export async function syncActiveSpaceWithWindow<T extends SpaceSyncDataType>(
    syncData: SpaceSyncData<T>
  ) {
    const { activeWindow, activeSpace: prevActiveSpace, type, data } = syncData;

    let newActiveSpaceUpdateProps: Partial<DataModel.ActiveSpace> = {};

    switch (type) {
      case "tab":
        const tab = data as ChromeTabWithId;
        const prevActiveTab = prevActiveSpace.tabs.find(
          (prevActiveTab) => prevActiveTab.tabInfo.id === tab.id
        );
        if (!prevActiveTab) {
          const errorMessage = `syncActiveSpaceWithWindow::activeSpace ${prevActiveSpace.id} has no tab with id ${tab.id}`;
          console.error(errorMessage);
          throw new Error(errorMessage);
        }

        const newActiveTab = {
          ...prevActiveTab,
          tabUrl: tab.url,
          tabTitle: tab.title,
        };
        const newActiveSpaceTabs = prevActiveSpace.tabs.map((prevActiveTab) =>
          prevActiveTab.tabInfo.id === tab.id ? newActiveTab : prevActiveTab
        );
        newActiveSpaceUpdateProps = { tabs: newActiveSpaceTabs };
        break;
      case "tabGroup":
        const tabGroup = data as ChromeTabGroupWithId;
        if (tabGroup.id !== prevActiveSpace.tabGroupInfo.id) {
          const errorMessage = `syncActiveSpaceWithWindow::activeSpace ${prevActiveSpace.id} has no tab group with id ${tabGroup.id}`;
          console.error(errorMessage);
          throw new Error(errorMessage);
        }
        newActiveSpaceUpdateProps = {
          tabGroupInfo: {
            ...prevActiveSpace.tabGroupInfo,
            title: tabGroup.title,
            color: tabGroup.color,
          },
        };
        break;
      default:
        const errorMessage = `syncActiveSpaceWithWindow::syncData has invalid type ${type}`;
        console.error(errorMessage);
        throw new Error(errorMessage);
    }

    try {
      await ActiveWindowSpace.update(
        prevActiveSpace.id,
        activeWindow.id,
        newActiveSpaceUpdateProps
      );
    } catch (error) {
      const errorMessage = `syncActiveSpaceWithWindow::unable to sync active space ${prevActiveSpace.id} with window ${activeWindow.windowId}. Error: ${error}`;
      console.error(errorMessage);
      throw new Error(errorMessage);
    }
  }

  export async function findActiveSpaceForChromeObject<
    T extends ActiveSpaceForChromeObjectFinder.FindType
  >(
    windowId: ChromeWindowId,
    chromeObject: ActiveSpaceForChromeObjectFinder.FindChromeObjectType<T>
  ): Promise<ActiveSpaceForChromeObjectFinder.FindResult<T> | undefined> {
    try {
      const activeWindows = await ActiveWindow.getAll();
      activeWindows.forEach((activeWindow) => {
        if (activeWindow.windowId !== windowId) {
          return;
        }

        for (let activeSpace of activeWindow.spaces) {
          let resultType:
            | ActiveSpaceForChromeObjectFinder.FindResultType<ActiveSpaceForChromeObjectFinder.FindType>
            | undefined;

          if (Misc.isTab(chromeObject)) {
            const tab = chromeObject as ChromeTabWithId;
            const { tabs } = activeSpace;
            const activeTab = tabs.find((t) => t.tabInfo.id === tab.id);
            if (!activeTab) {
              continue;
            }
          } else if (Misc.isTabGroup(chromeObject)) {
            const tabGroup = chromeObject as ChromeTabGroupWithId;

            if (tabGroup.id !== activeSpace.tabGroupInfo.id) {
              continue;
            }

            resultType = "primaryTabGroup";
          } else {
            throw new Error(`findActiveSpaceForChromeObject::chromeObject has invalid type`);
          }

          if (resultType) {
            return {
              activeSpace,
              type: resultType,
            } as ActiveSpaceForChromeObjectFinder.FindResult<ActiveSpaceForChromeObjectFinder.FindType>;
          }
        }
      });

      return undefined;
    } catch (error) {
      const errorMessage = `findActiveSpaceForChromeObject::Error: ${error}`;
      console.error(errorMessage);
      throw new Error(errorMessage);
    }
  }
}
