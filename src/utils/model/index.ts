import { v4 as uuidv4 } from "uuid";
import {
  TidyTabs,
  ChromeWindowId,
  ChromeWindowWithId,
  ChromeTabGroupWithId,
  ChromeTabWithId,
  ActiveSpaceForChromeObjectFinder,
  ChromeTabGroupId,
  ChromeTabId,
  LocalStorage,
} from "../../types/";
import * as Misc from "../misc";
import * as Storage from "../storage";
import { matchWindowsToActiveWindows } from "../windowMatcher";

export async function initialize() {
  try {
    const prevActiveWindows = await ActiveWindow.getAll();
    const windows = Misc.getWindowsWithIds(await chrome.windows.getAll());

    const matchedWindowsToPrevActiveWindows = await matchWindowsToActiveWindows(
      windows,
      prevActiveWindows
    );

    const spaceAutoCollapseTimersToStart: { activeWindowId: string; spaceId: string }[] = [];

    const newActiveWindows = matchedWindowsToPrevActiveWindows.map(
      (matchedWindowToPrevActiveWindowInfo) => {
        const { windowInfo, candidateMatchedWindowInfo } = matchedWindowToPrevActiveWindowInfo;
        const {
          activeWindow: prevActiveWindow,
          matchedMiscTabGroupToSpace,
          matchedNonMiscTabGroupsToSpaces,
        } = candidateMatchedWindowInfo;

        // group any non-grouped tabs in the window
        // let nonGroupedTabsNewGroup: ChromeTabGroupWithId | undefined;
        // const nonGroupedTabs = windowInfo.tabs.filter(
        //   (tab) => tab.groupId === chrome.tabGroups.TAB_GROUP_ID_NONE
        // );
        // if (nonGroupedTabs.length > 0) {
        //   const tabGroupId = await chrome.tabs.group({
        //     createProperties: {
        //       windowId: windowInfo.window.id,
        //     },
        //     tabIds: nonGroupedTabs.map((tab) => tab.id),
        //   });
        //   nonGroupedTabsNewGroup = await chrome.tabGroups.get(tabGroupId);
        // }

        let newActiveWindowSpaces: TidyTabs.ActiveSpace[];
        let newActiveWindowSelectedSpaceId: string | undefined;
        let newActiveWindowPrimarySpaceId: string | undefined;
        let newActiveWindowSelectedTabFocusType:
          | TidyTabs.ActiveWindow["selectedSpaceFocusType"]
          | undefined;
        let newActiveWindowSelectedTabId: ChromeTabId | undefined;
        let newActiveWindowMiscTabGroup: ChromeTabGroupWithId | undefined;

        const selectedTab = windowInfo.tabs.find((tab) => tab.active)!;
        newActiveWindowSelectedTabId = selectedTab.id;
        const tabGroupIdForSelectedTab = selectedTab.groupId;

        if (tabGroupIdForSelectedTab === chrome.tabGroups.TAB_GROUP_ID_NONE) {
          newActiveWindowSelectedTabFocusType = "nonSpaceTabFocus";
        }

        newActiveWindowSpaces = windowInfo.tabGroups.map((tabGroup) => {
          const matchedSpaceId = matchedNonMiscTabGroupsToSpaces.find(
            (matchedNonMiscTabGroupToSpaceInfo) =>
              matchedNonMiscTabGroupToSpaceInfo.tabGroupId === tabGroup.id
          )?.spaceId;

          const isTabGroupForSelectedTab = tabGroupIdForSelectedTab === tabGroup.id;
          const isTabGroupForPrimarySpace =
            matchedSpaceId && matchedSpaceId === prevActiveWindow.primarySpaceId;
          const isTabGroupForMiscSpace =
            matchedMiscTabGroupToSpace && tabGroup.id === matchedMiscTabGroupToSpace.tabGroupId;

          if (isTabGroupForSelectedTab) {
            if (isTabGroupForPrimarySpace) {
              newActiveWindowSelectedTabFocusType = "primaryFocus";
            } else if (isTabGroupForMiscSpace) {
              newActiveWindowSelectedTabFocusType = "secondaryFocus";
            } else {
              newActiveWindowSelectedTabFocusType = "peakFocus";
            }
          }

          const tabsInGroup = windowInfo.tabs.filter((tab) => tab.groupId === tabGroup.id);
          const newWindowActiveSpace = ActiveWindowSpace.createFromExistingTabGroup(
            tabGroup,
            tabsInGroup
          );

          if (isTabGroupForSelectedTab) {
            newActiveWindowSelectedSpaceId = newWindowActiveSpace.id;
          }

          if (isTabGroupForPrimarySpace) {
            newActiveWindowPrimarySpaceId = newWindowActiveSpace.id;
          }

          if (isTabGroupForMiscSpace) {
            newActiveWindowMiscTabGroup = tabGroup;
          }

          return newWindowActiveSpace;
        });

        if (
          newActiveWindowSpaces.length === 0 ||
          !newActiveWindowSelectedSpaceId ||
          !newActiveWindowPrimarySpaceId ||
          !newActiveWindowSelectedTabFocusType ||
          !newActiveWindowSelectedTabId ||
          !newActiveWindowMiscTabGroup ||
          !newActiveWindowMiscTabGroup
        ) {
          const errorMessage = `initializeDataModel::Could not create active spaces for window ${windowInfo.window.id} from matched window ${prevActiveWindow.windowId}`;
          console.error(errorMessage);
          throw new Error(errorMessage);
        }

        const newActiveWindow = ActiveWindow.create({
          windowId: windowInfo.window.id,
          spaces: newActiveWindowSpaces,
          selectedSpaceId: newActiveWindowSelectedSpaceId,
          primarySpaceId: newActiveWindowPrimarySpaceId,
          selectedSpaceFocusType: newActiveWindowSelectedTabFocusType,
          selectedTabId: newActiveWindowSelectedTabId,
          miscTabGroup: newActiveWindowMiscTabGroup,
        });

        if (
          newActiveWindowSelectedTabFocusType === "peakFocus" ||
          newActiveWindowSelectedTabFocusType === "secondaryFocus"
        ) {
          spaceAutoCollapseTimersToStart.push({
            activeWindowId: newActiveWindow.id,
            spaceId: newActiveWindowSelectedSpaceId,
          });
        }

        return newActiveWindow;
      }
    );

    const newDataModel = {
      ...Storage.LOCAL_STORAGE_DEFAULT_VALUES,
      activeWindows: newActiveWindows,
    } as LocalStorage;

    await Storage.setItems(newDataModel);

    spaceAutoCollapseTimersToStart.forEach(async (timerToStart) => {
      await SpaceAutoCollapseTimer.startAutoCollapseTimerForSpace(
        timerToStart.activeWindowId,
        timerToStart.spaceId
      );
    });
  } catch (error) {
    const errorMessage = new Error(
      `DataModel::initialize:Could not intitialize data model: ${error}`
    );
    console.error(errorMessage);
    throw error;
  }
}

export async function syncActiveSpaceWithWindow<T extends TidyTabs.SpaceSyncDataType>(
  syncData: TidyTabs.SpaceSyncData<T>
) {
  const { activeWindow, activeSpace: prevActiveSpace, type, data } = syncData;

  let newActiveSpaceUpdateProps: Partial<TidyTabs.ActiveSpace> = {};

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
    await ActiveWindowSpace.update(prevActiveSpace.id, activeWindow.id, newActiveSpaceUpdateProps);
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

export namespace ActiveWindowTab {
  export function create(createProperties: TidyTabs.ActiveTabCreateProperties) {
    // TODO: validate createProperties
    const id = createProperties.id || uuidv4();
    return {
      ...createProperties,
      id,
    } as TidyTabs.ActiveTab;
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
}

export namespace ActiveWindowSpace {
  export function create(createProperties: TidyTabs.ActiveSpaceCreateProperties) {
    // TODO: validate createProperties
    const id = createProperties.id || uuidv4();
    return {
      ...createProperties,
      id,
    } as TidyTabs.ActiveSpace;
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
    updateProperties: Partial<TidyTabs.ActiveSpace>
  ) {
    try {
      const activeWindows = await ActiveWindow.getAll();
      for (let activeWindow of activeWindows) {
        if (activeWindow.id !== activeWindowId) {
          continue;
        }

        let updatedSpace: TidyTabs.ActiveSpace | undefined;
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
}

export namespace ActiveWindow {
  export function create(createProperties: TidyTabs.ActiveWindowCreateProperties) {
    // TODO: validate createProperties
    const id = createProperties.id || uuidv4();
    return {
      ...createProperties,
      id,
    } as TidyTabs.ActiveWindow;
  }

  export async function getAll() {
    const result = await Storage.getGuaranteedItems<{
      activeWindows: LocalStorage["activeWindows"];
    }>("activeWindows");
    return result.activeWindows;
  }

  export async function get(activeWindowId: string) {
    const activeWindows = await getAll();
    const activeWindow = activeWindows.find((window) => window.id === activeWindowId);
    if (!activeWindow) {
      const errorMessage = `ActiveWindow::get: No active window found with id: ${activeWindowId}`;
      console.error(errorMessage);
      throw new Error(errorMessage);
    }
    return activeWindow;
  }

  export async function set(activeWindow: TidyTabs.ActiveWindow) {
    const prevActiveWindows = await getAll();
    await setAll([...prevActiveWindows, activeWindow]);
  }

  export async function setAll(activeWindows: LocalStorage["activeWindows"]) {
    await Storage.setItems({ activeWindows });
  }

  export async function update(id: string, updateProperties: Partial<TidyTabs.ActiveWindow>) {
    const activeWindows = await getAll();
    const prevActiveWindow = activeWindows.find((window) => window.id === id);

    if (!prevActiveWindow) {
      const errorMessage = `ActiveWindow::update: No active window found with id: ${id}`;
      console.error(errorMessage);
      throw new Error(errorMessage);
    }

    const updatedWindow = { ...prevActiveWindow, ...updateProperties };

    const updatedActiveWindows = activeWindows.map((window) =>
      window.id === id ? updatedWindow : window
    );

    return await setAll(updatedActiveWindows);
  }
}

export namespace SpaceAutoCollapseTimer {
  export function create(activeWindowId: string, spaceId: string) {
    const id = uuidv4();
    const timerName = `spaceAutoCollapseTimer:${id}`;
    const when = Date.now() + 5000;
    chrome.alarms.create(timerName, { when });
    return {
      id,
      activeWindowId,
      spaceId,
      time: when,
    } as TidyTabs.SpaceAutoCollapseTimer;
  }

  export async function get(timerId: string) {
    const spaceAutoCollapseTimers = await getAll();
    return spaceAutoCollapseTimers.find((timer) => timer.id === timerId);
  }

  export async function getAll() {
    const result = await Storage.getGuaranteedItems<{
      spaceAutoCollapseTimers: LocalStorage["spaceAutoCollapseTimers"];
    }>("spaceAutoCollapseTimers");
    return result.spaceAutoCollapseTimers;
  }

  export async function set(timer: TidyTabs.SpaceAutoCollapseTimer) {
    const prevSpaceAutoCollapseTimers = await getAll();
    await setAll([...prevSpaceAutoCollapseTimers, timer]);
  }

  export async function setAll(timers: LocalStorage["spaceAutoCollapseTimers"]) {
    await Storage.setItems({ spaceAutoCollapseTimers: timers });
  }

  export async function startAutoCollapseTimerForSpace(activeWindowId: string, spaceId: string) {
    const timer = create(activeWindowId, spaceId);
    await set(timer);
    return timer;
  }
}
