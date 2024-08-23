import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import Storage from "../storage";
import { UserPreference } from "../UIComponents";
import { Switch, Container, Typography, CircularProgress, Box, AppBar, Toolbar, IconButton } from "@mui/material";
import SettingsOutlinedIcon from "@mui/icons-material/SettingsOutlined";
import CloseOutlinedIcon from "@mui/icons-material/CloseOutlined";
import { App } from "./app";
import Types from "../types";
import ChromeWindowHelper from "../chromeWindowHelper";
import Logger from "../logger";
import Misc from "../misc";

const logger = Logger.createLogger("popup");

Storage.start();

const Popup = () => {
  const myLogger = logger.createNestedLogger("Popup");
  const [activeWindow, setActiveWindow] = useState<Types.ActiveWindow | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      // the current window the popup is open in
      const window = (await chrome.windows.getCurrent()) as Types.ChromeWindowWithId;
      chrome.runtime.sendMessage({ type: "getActiveWindow", data: { windowId: window.id } }, (response) => {
        if (response.error) {
          setError(response.error);
        } else {
          setActiveWindow(response.activeWindow ?? null);
        }

        setIsLoading(false);
      });
    })();
  }, []);

  async function onChangeFocusMode(e: React.ChangeEvent<HTMLInputElement>) {
    // TODO: for encapsulation purposes, the following logic should be in ActiveWindowManager. Simply send a 'onChangeFocusMode' message and let it do the rest.
    let newFocusMode: Types.ActiveWindow["focusMode"];
    let savedTabGroupColorsToRestore: Types.ActiveWindowFocusMode["savedTabGroupColors"] | null = null;
    if (!activeWindow) {
      throw new Error("onChangeFocusMode called with no active window");
    }
    const myActiveWindow = activeWindow;
    const { windowId } = myActiveWindow;

    const enableFocusMode = e.target.checked;
    if (enableFocusMode) {
      const tabGroups = (await chrome.tabGroups.query({ windowId })) as Types.ChromeTabGroupWithId[];
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
              let newColor: chrome.tabGroups.ColorEnum;
              // FIXME: the compiler thinks that savedTabGroupColorsToRestore could be null
              const savedColor = savedTabGroupColorsToRestore!.find((savedColor) => savedColor.tabGroupId === tabGroup.id)?.color;
              if (savedColor) {
                newColor = savedColor;
              } else {
                newColor = colors[colorIndex++ % colors.length];
              }

              return ChromeWindowHelper.updateTabGroupWithRetryHandler(tabGroup.id, { color: newColor });
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

  const openOptionsPage = () => {
    chrome.runtime.openOptionsPage();
  };

  const closePopup = () => {
    window.close();
  };

  let content: React.ReactNode;

  if (isLoading) {
    content = (
      <Box
        sx={{
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          height: "100%",
        }}
      >
        <CircularProgress />
      </Box>
    );
  } else if (error) {
    content = (
      <Typography variant="h6" gutterBottom>
        {error}
      </Typography>
    );
  } else if (activeWindow === null) {
    content = (
      <Typography variant="h6" gutterBottom>
        This window isnt active
      </Typography>
    );
  } else {
    const enabled = activeWindow.focusMode !== null;
    content = <UserPreference name="Focus Mode" control={<Switch checked={enabled} onChange={onChangeFocusMode} />} enabled={enabled} />;
  }

  return (
    <Container sx={{ height: "100vh", display: "flex", flexDirection: "column", gap: 2, padding: 0 }}>
      <AppBar position="static">
        <Toolbar sx={{ justifyContent: "space-between" }}>
          <Box sx={{ display: "flex", alignItems: "center" }}>
            <img src="/icon.png" alt="Logo" style={{ marginRight: "10px" }} />
          </Box>
          <Box>
            <IconButton onClick={openOptionsPage} sx={{ color: "gray" }}>
              <SettingsOutlinedIcon fontSize="small" />
            </IconButton>
            <IconButton onClick={closePopup} sx={{ color: "gray" }}>
              <CloseOutlinedIcon fontSize="small" />
            </IconButton>
          </Box>
        </Toolbar>
      </AppBar>
      <Container sx={{ flexGrow: 1, overflow: "auto" }}>{content}</Container>
    </Container>
  );
};

const root = createRoot(document.getElementById("root")!);
root.render(
  <App>
    <Popup />
  </App>
);
