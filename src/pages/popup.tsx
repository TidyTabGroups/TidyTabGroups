import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import Storage from "../storage";
import { UserPreference, UserPreferenceCard, UserPreferenceProps } from "../UIComponents";
import { Switch, Container, Typography, CircularProgress, Box, AppBar, Toolbar, IconButton } from "@mui/material";
import SettingsOutlinedIcon from "@mui/icons-material/SettingsOutlined";
import CloseOutlinedIcon from "@mui/icons-material/CloseOutlined";
import { App } from "./app";
import Types from "../types";
import ChromeWindowHelper from "../chromeWindowHelper";
import Logger from "../logger";
import Misc from "../misc";

const logger = Logger.createLogger("popup");

interface CurrentActiveWindowTabGroupInfo {
  id: Types.ActiveWindowTabGroup["id"];
  title: Types.ActiveWindowTabGroup["title"];
  color: Types.ActiveWindowTabGroup["color"];
  keepOpen: Types.ActiveWindowTabGroup["keepOpen"];
}

Storage.start();

const Popup = () => {
  const [activeWindow, setActiveWindow] = useState<Types.ActiveWindow | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentActiveWindowTabGroupInfo, setCurrentActiveWindowTabGroupInfo] = useState<CurrentActiveWindowTabGroupInfo | null>(null);
  const [userPreferences, setUserPreferences] = useState<Types.UserPreferences | null>(null);

  useEffect(() => {
    Misc.callAsync(async () => {
      const myLogger = logger.createNestedLogger("componentDidMount");
      try {
        const currentWindow = (await chrome.windows.getCurrent()) as Types.ChromeWindowWithId;
        const [activeWindow, currentActiveWindowTabGroupInfo, userPreferences] = await Promise.all([
          fetchActiveWindow(currentWindow.id),
          fetchCurrentTabGroupInfo(currentWindow.id),
          fetchUserPreferences(),
        ]);

        setActiveWindow(activeWindow);
        setCurrentActiveWindowTabGroupInfo(currentActiveWindowTabGroupInfo);
        setUserPreferences(userPreferences);
      } catch (error) {
        setError(myLogger.getPrefixedMessage(Misc.getErrorMessage(error)));
      } finally {
        setIsLoading(false);
      }
    });

    // All the events that can potentially change the current tab group
    chrome.tabs.onActivated.addListener(onTabEditEventForCurrentActiveWindowTabGroup);
    chrome.tabs.onAttached.addListener(onTabEditEventForCurrentActiveWindowTabGroup);
    chrome.tabs.onDetached.addListener(onTabEditEventForCurrentActiveWindowTabGroup);
    chrome.tabGroups.onCreated.addListener(onTabEditEventForCurrentActiveWindowTabGroup);
    chrome.tabGroups.onRemoved.addListener(onTabEditEventForCurrentActiveWindowTabGroup);
    chrome.tabGroups.onUpdated.addListener(onTabEditEventForCurrentActiveWindowTabGroup);

    Storage.addChangeListener<"userPreferences">(onStorageChange);

    return () => {
      chrome.tabs.onActivated.removeListener(onTabEditEventForCurrentActiveWindowTabGroup);
      chrome.tabs.onAttached.removeListener(onTabEditEventForCurrentActiveWindowTabGroup);
      chrome.tabs.onDetached.removeListener(onTabEditEventForCurrentActiveWindowTabGroup);
      chrome.tabGroups.onCreated.removeListener(onTabEditEventForCurrentActiveWindowTabGroup);
      chrome.tabGroups.onRemoved.removeListener(onTabEditEventForCurrentActiveWindowTabGroup);
      chrome.tabGroups.onUpdated.removeListener(onTabEditEventForCurrentActiveWindowTabGroup);

      Storage.removeChangeListener<"userPreferences">(onStorageChange);
    };
  }, []);

  async function onStorageChange(changes: {
    userPreferences?:
      | {
          newValue: Types.UserPreferences;
          oldValue: Types.UserPreferences;
        }
      | undefined;
  }) {
    if (changes.userPreferences) {
      setUserPreferences(changes.userPreferences.newValue);
    }
  }

  async function onTabEditEventForCurrentActiveWindowTabGroup() {
    if (activeWindow === null) {
      return;
    }

    const currentActiveWindowTabGroupInfo = await fetchCurrentTabGroupInfo(activeWindow.windowId);
    setCurrentActiveWindowTabGroupInfo(currentActiveWindowTabGroupInfo);
  }

  async function onChangeFocusMode(e: React.ChangeEvent<HTMLInputElement>) {
    const myLogger = logger.createNestedLogger("onChangeFocusMode");
    try {
      if (!activeWindow) {
        throw new Error("onChangeFocusMode called with no active window");
      }

      const response = await chrome.runtime.sendMessage({
        type: "onChangeFocusMode",
        data: { windowId: activeWindow.windowId, enabled: e.target.checked },
      });

      if (response.error) {
        throw new Error(response.error);
      } else {
        setActiveWindow(response.activeWindow);
      }
    } catch (error) {
      setError(myLogger.getPrefixedMessage(Misc.getErrorMessage(error)));
    }
  }

  async function onChangeKeepTabGroupOpen(e: React.ChangeEvent<HTMLInputElement>) {
    const myLogger = logger.createNestedLogger("onChangeKeepTabGroupOpen");
    try {
      if (!activeWindow) {
        throw new Error("onChangeKeepTabGroupOpen called with no active window");
      }

      if (!currentActiveWindowTabGroupInfo) {
        throw new Error("onChangeKeepTabGroupOpen called with no current tab group info");
      }

      const { windowId } = activeWindow;
      const response = await chrome.runtime.sendMessage({
        type: "onChangeKeepTabGroupOpen",
        data: { windowId, tabGroupId: currentActiveWindowTabGroupInfo.id, enabled: e.target.checked },
      });

      if (response.error) {
        throw new Error(response.error);
      } else {
        const { activeWindowTabGroup } = response;
        setCurrentActiveWindowTabGroupInfo({
          id: activeWindowTabGroup.id,
          title: activeWindowTabGroup.title,
          color: activeWindowTabGroup.color,
          keepOpen: activeWindowTabGroup.keepOpen,
        });
      }
    } catch (error) {
      setError(myLogger.getPrefixedMessage(Misc.getErrorMessage(error)));
    }
  }

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
    const currentTabGroupPreferences: UserPreferenceProps[] = [];

    if (currentActiveWindowTabGroupInfo && userPreferences) {
      if (userPreferences.collapseUnfocusedTabGroups) {
        currentTabGroupPreferences.push({
          name: "Keep open",
          control: <Switch checked={currentActiveWindowTabGroupInfo.keepOpen} onChange={onChangeKeepTabGroupOpen} />,
          enabled: currentActiveWindowTabGroupInfo.keepOpen,
        });
      }
    }

    const focusModeEnabled = activeWindow.focusMode !== null;
    content = (
      <Box display="flex" flexDirection="column" gap={2}>
        <UserPreferenceCard
          title="Current Window"
          userPreferences={[
            { name: "Focus Mode", control: <Switch checked={focusModeEnabled} onChange={onChangeFocusMode} />, enabled: focusModeEnabled },
          ]}
        />
        {currentTabGroupPreferences.length > 0 && <UserPreferenceCard title="Current Tab Group" userPreferences={currentTabGroupPreferences} />}
      </Box>
    );
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

async function fetchCurrentTabGroupInfo(windowId: Types.ChromeWindowId): Promise<CurrentActiveWindowTabGroupInfo | null> {
  const myLogger = logger.createNestedLogger("fetchCurrentTabGroupInfo");
  try {
    const [activeTab] = (await chrome.tabs.query({ active: true, windowId })) as (Types.ChromeTabWithId | undefined)[];
    if (!activeTab || activeTab.groupId === chrome.tabGroups.TAB_GROUP_ID_NONE) {
      return null;
    }

    return await fetchActiveWindowTabGroup(activeTab.windowId, activeTab.groupId);
  } catch (error) {
    throw new Error(myLogger.getPrefixedMessage(Misc.getErrorMessage(error)));
  }
}

async function fetchActiveWindow(windowId: Types.ChromeWindowId) {
  const myLogger = logger.createNestedLogger("fetchActiveWindow");
  try {
    const response = await chrome.runtime.sendMessage({ type: "getActiveWindow", data: { windowId } });
    if (response.error) {
      throw new Error(response.error);
    } else {
      return response.activeWindow ?? null;
    }
  } catch (error) {
    throw new Error(myLogger.getPrefixedMessage(Misc.getErrorMessage(error)));
  }
}

async function fetchActiveWindowTabGroup(windowId: Types.ChromeWindowId, tabGroupId: Types.ChromeTabGroupWithId["id"]) {
  const myLogger = logger.createNestedLogger("fetchActiveWindowTabGroup");
  try {
    const response = await chrome.runtime.sendMessage({ type: "getActiveWindowTabGroup", data: { windowId, tabGroupId } });
    if (response.error) {
      throw new Error(response.error);
    } else {
      return response.activeWindowTabGroup ?? null;
    }
  } catch (error) {
    throw new Error(myLogger.getPrefixedMessage(Misc.getErrorMessage(error)));
  }
}

async function fetchUserPreferences() {
  const { userPreferences } = await Storage.getItems(["userPreferences"]);
  return userPreferences;
}

function openOptionsPage() {
  chrome.runtime.openOptionsPage();
}

function closePopup() {
  window.close();
}
