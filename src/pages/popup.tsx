import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import * as Storage from "../storage";
import { UserPreference } from "./userPreference";
import { Switch, Container, Divider, createTheme, ThemeProvider, useMediaQuery, CssBaseline, AppBar, Typography } from "@mui/material";
import { App } from "./app";
import Types from "../types";
import ChromeWindowHelper from "../chromeWindowHelper";
import Logger from "../logger";
import Misc from "../misc";
import { ChromeTabGroupColorEnum } from "../types/types";

const logger = Logger.createLogger("popup");

Storage.start();

const Popup = () => {
  const myLogger = logger.createNestedLogger("Popup");
  const [activeWindow, setActiveWindow] = useState<Types.ActiveWindow | undefined | null>(null);
  const isLoading = activeWindow === null;
  const noActiveWindow = activeWindow === undefined;

  useEffect(() => {
    (async () => {
      // the current window the popup is open in
      const window = (await chrome.windows.getCurrent()) as Types.ChromeWindowWithId;
      chrome.runtime.sendMessage({ type: "getActiveWindow", data: { windowId: window.id } }, (response) => {
        if (response.activeWindow) {
          setActiveWindow(response.activeWindow);
        } else {
          myLogger.error("No activeWindow in response", response.error);
        }
      });
    })();
  }, []);

  async function onChangeFocusMode(e: React.ChangeEvent<HTMLInputElement>) {
    let newFocusMode: Types.ActiveWindow["focusMode"];
    let savedTabGroupColorsToRestore: Types.ActiveWindowFocusMode["savedTabGroupColors"] | null = null;
    if (!activeWindow) {
      throw new Error("onChangeFocusMode called with no active window");
    }
    const myActiveWindow = activeWindow;
    const { windowId } = myActiveWindow;

    const enableFocusMode = e.target.checked;
    if (enableFocusMode) {
      const tabs = (await chrome.tabs.query({ windowId })) as Types.ChromeTabWithId[];
      const activeTab = tabs.find((tab) => tab.active);

      if (!activeTab) {
        throw new Error("No active tab found");
      }
      const tabGroups = await ChromeWindowHelper.getTabGroupsOrdered(tabs);
      const { lastSeenFocusModeColors } = await Storage.getItems(["lastSeenFocusModeColors"]);

      newFocusMode = {
        colors: lastSeenFocusModeColors,
        savedTabGroupColors: tabGroups.map((tabGroup) => ({ tabGroupId: tabGroup.id, color: tabGroup.color })),
      } as Types.ActiveWindowFocusMode;
    } else {
      const { focusMode } = myActiveWindow;
      if (focusMode === null) {
        throw new Error("Focus mode is null");
      }

      savedTabGroupColorsToRestore = focusMode.savedTabGroupColors;
      newFocusMode = null;
    }

    chrome.runtime.sendMessage({ type: "updateActiveWindow", data: { windowId, updateProps: { focusMode: newFocusMode } } }, async (response) => {
      // 1. set the new activeWindow
      // 2. focus the active tab group
      // 3. restore the colors of the tab groups that were saved before enabling focus mode
      // 4. if the window is focused, set the new lastSeenFocusModeColors and lastFocusedWindowHadFocusMode
      const { activeWindow } = response;
      if (activeWindow) {
        // 1
        setActiveWindow(activeWindow);

        // 2
        const [activeTab] = (await chrome.tabs.query({ active: true, windowId })) as Types.ChromeTabWithId[];
        let getTabGroups = Misc.lazyCall(() => chrome.tabGroups.query({ windowId }));
        if (activeTab) {
          // FIXME: this needs to update the active window tab groups
          const latestTabGroups = await ChromeWindowHelper.focusTabGroupWithRetryHandler(activeTab.groupId, await getTabGroups(), {
            collapseUnfocusedTabGroups: true,
            highlightColors: activeWindow.focusMode?.colors,
          });

          if (latestTabGroups) {
            getTabGroups = async () => latestTabGroups;
          }
        }

        if (savedTabGroupColorsToRestore !== null) {
          const tabGroups = await getTabGroups();
          let colorIndex = 0;
          // take out grey, just because it's not a very nice color
          const colors = ChromeWindowHelper.TAB_GROUP_COLORS.filter((color) => color !== "grey");
          await Promise.all(
            tabGroups.map((tabGroup) => {
              let newColor: ChromeTabGroupColorEnum;
              // FIXME: the compiler thinks that savedTabGroupColorsToRestore could be null
              const savedColor = savedTabGroupColorsToRestore!.find((savedColor) => savedColor.tabGroupId === tabGroup.id)?.color;
              if (savedColor) {
                newColor = savedColor;
              } else {
                newColor = colors[colorIndex++ % colors.length];
              }

              // FIXME: figure out why newColor: Types.ChromeTabGroupColorEnum cant be passed in to updateTabGroup with the same type
              // @ts-ignore
              return ChromeWindowHelper.updateTabGroup(tabGroup.id, { color: newColor });
            })
          );
        }

        // 3
        // We dont need to await this
        // TODO: shouldn't this be done only when focus mode is toggled off?
        savedTabGroupColorsToRestore?.map(({ tabGroupId, color }) => ChromeWindowHelper.updateTabGroupWithRetryHandler(tabGroupId, { color }));

        // 4
        const window = await ChromeWindowHelper.getIfWindowExists(activeWindow.windowId);
        if (window?.focused) {
          await Storage.setItems({
            lastSeenFocusModeColors: activeWindow.focusMode?.colors || null,
            lastFocusedWindowHadFocusMode: activeWindow.focusMode !== null,
          });
        }
      } else {
        myLogger.error("No activeWindow in response", response.error);
      }
    });
  }

  if (isLoading) {
    return null;
  }

  return (
    <Container maxWidth="md" sx={{ height: "100vh", width: "50vw", padding: "24px" }}>
      {noActiveWindow ? (
        <Typography variant="h6" gutterBottom>
          This window isnt active
        </Typography>
      ) : (
        <UserPreference name="Focus Mode" control={<Switch checked={activeWindow.focusMode !== null} onChange={onChangeFocusMode} />} />
      )}
    </Container>
  );
};

const root = createRoot(document.getElementById("root")!);
root.render(
  <App>
    <Popup />
  </App>
);
