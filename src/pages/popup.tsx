import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import * as Storage from "../storage";
import { UserPreference } from "./userPreference";
import { Switch, Container, Divider, createTheme, ThemeProvider, useMediaQuery, CssBaseline, AppBar, Typography } from "@mui/material";
import { App } from "./app";
import Types from "../types";
import ChromeWindowHelper from "../chromeWindowHelper";
import Logger from "../logger";

const logger = Logger.getLogger("popup");

Storage.start();

const Popup = () => {
  const myLogger = logger.getNestedLogger("Popup");
  const [activeWindow, setActiveWindow] = useState<Types.ActiveWindow | undefined | null>(null);
  const isLoading = activeWindow === null;
  const noActiveWindow = activeWindow === undefined;

  useEffect(() => {
    (async () => {
      // the current window the popup is open in
      const window = (await chrome.windows.getCurrent()) as Types.ChromeWindowWithId;
      chrome.runtime.sendMessage({ type: "getActiveWindow", data: { windowId: window.id } }, (response) => {
        if (response.activeWindow) {
          Logger.attentionLogger.log("Popup", "Active window", response.activeWindow);
          setActiveWindow(response.activeWindow);
        } else {
          myLogger.error("No activeWindow in response", response.error);
        }
      });
    })();
  }, []);

  async function onChangeFocusMode(e: React.ChangeEvent<HTMLInputElement>) {
    let newFocusMode: Types.ActiveWindow["focusMode"];
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

      const { savedTabGroupColors } = focusMode;
      await Promise.all(savedTabGroupColors.map(({ tabGroupId, color }) => ChromeWindowHelper.updateTabGroup(tabGroupId, { color })));
      newFocusMode = null;
    }

    chrome.runtime.sendMessage({ type: "updateActiveWindow", data: { windowId, updateProps: { focusMode: newFocusMode } } }, async (response) => {
      const { activeWindow } = response;
      if (activeWindow) {
        setActiveWindow(activeWindow);
        const [activeTab] = (await chrome.tabs.query({ active: true, windowId })) as Types.ChromeTabWithId[];
        if (activeTab) {
          await ChromeWindowHelper.focusTabGroup(activeTab.groupId, windowId, {
            collapseUnfocusedTabGroups: true,
            highlightColors: activeWindow.focusMode?.colors,
          });
        }

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

  Logger.attentionLogger.log(activeWindow?.focusMode);

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
