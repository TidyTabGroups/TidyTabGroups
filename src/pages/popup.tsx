import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import Storage from "../storage";
import { UserPreference, UserPreferenceCard, UserPreferenceProps } from "../UIComponents";
import { Switch, Container, Typography, CircularProgress, Box, AppBar, Toolbar, IconButton } from "@mui/material";
import SettingsOutlinedIcon from "@mui/icons-material/SettingsOutlined";
import CloseOutlinedIcon from "@mui/icons-material/CloseOutlined";
import { App } from "./app";
import Types from "../types";
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
  const [currentWindowId, setCurrentWindowId] = useState<Types.ChromeWindowId | null>(null);
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
        const [activeWindow, userPreferences] = await Promise.all([fetchActiveWindow(currentWindow.id), fetchUserPreferences()]);

        let currentActiveWindowTabGroupInfo: CurrentActiveWindowTabGroupInfo | null = null;
        if (activeWindow) {
          currentActiveWindowTabGroupInfo = await fetchCurrentTabGroupInfo(currentWindow.id);
        }

        setCurrentWindowId(currentWindow.id);
        setActiveWindow(activeWindow ?? null);
        setCurrentActiveWindowTabGroupInfo(currentActiveWindowTabGroupInfo);
        setUserPreferences(userPreferences);
      } catch (error) {
        setError(myLogger.getPrefixedMessage(Misc.getErrorMessage(error)));
      } finally {
        setIsLoading(false);
      }
    });

    chrome.windows.onRemoved.addListener(onCurrentWindowRemoved);

    // All the events that can potentially change the current tab group
    chrome.tabs.onActivated.addListener(onTabEditEventForCurrentActiveWindowTabGroup);
    chrome.tabs.onAttached.addListener(onTabEditEventForCurrentActiveWindowTabGroup);
    chrome.tabs.onDetached.addListener(onTabEditEventForCurrentActiveWindowTabGroup);
    chrome.tabGroups.onCreated.addListener(onTabEditEventForCurrentActiveWindowTabGroup);
    chrome.tabGroups.onRemoved.addListener(onTabEditEventForCurrentActiveWindowTabGroup);
    chrome.tabGroups.onUpdated.addListener(onTabEditEventForCurrentActiveWindowTabGroup);

    Storage.addChangeListener<"userPreferences">(onStorageChange);

    return () => {
      chrome.windows.onRemoved.removeListener(onCurrentWindowRemoved);

      chrome.tabs.onActivated.removeListener(onTabEditEventForCurrentActiveWindowTabGroup);
      chrome.tabs.onAttached.removeListener(onTabEditEventForCurrentActiveWindowTabGroup);
      chrome.tabs.onDetached.removeListener(onTabEditEventForCurrentActiveWindowTabGroup);
      chrome.tabGroups.onCreated.removeListener(onTabEditEventForCurrentActiveWindowTabGroup);
      chrome.tabGroups.onRemoved.removeListener(onTabEditEventForCurrentActiveWindowTabGroup);
      chrome.tabGroups.onUpdated.removeListener(onTabEditEventForCurrentActiveWindowTabGroup);

      Storage.removeChangeListener<"userPreferences">(onStorageChange);
    };
  }, []);
  useEffect(() => {
    onActiveWindowChanged();
  }, [activeWindow]);

  async function onActiveWindowChanged() {
    const myLogger = logger.createNestedLogger("onActiveWindowChanged");
    try {
      if (activeWindow !== null) {
        const currentActiveWindowTabGroupInfo = await fetchCurrentTabGroupInfo(activeWindow.windowId);
        setCurrentActiveWindowTabGroupInfo(currentActiveWindowTabGroupInfo);
      } else {
        setCurrentActiveWindowTabGroupInfo(null);
      }
    } catch (error) {
      throw new Error(myLogger.getPrefixedMessage(Misc.getErrorMessage(error)));
    }
  }

  function onCurrentWindowRemoved() {
    setCurrentWindowId(null);
    setActiveWindow(null);
    setCurrentActiveWindowTabGroupInfo(null);

    closePopup();
  }

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

  async function onChangeActivateCurrentWindow(e: React.ChangeEvent<HTMLInputElement>) {
    const myLogger = logger.createNestedLogger("onChangeActivateCurrentWindow");
    try {
      if (currentWindowId === null) {
        throw new Error("onChangeActivateCurrentWindow called with no currentWindowId");
      }

      const { activeWindow } = await messageActiveWindowManager<{ activeWindow: Types.ActiveWindow | undefined }>({
        type: "onChangeActivateCurrentWindow",
        data: { windowId: currentWindowId, enabled: e.target.checked },
      });
      setActiveWindow(activeWindow ?? null);
    } catch (error) {
      setError(myLogger.getPrefixedMessage(Misc.getErrorMessage(error)));
    }
  }

  async function onChangeFocusMode(e: React.ChangeEvent<HTMLInputElement>) {
    const myLogger = logger.createNestedLogger("onChangeFocusMode");
    try {
      if (!activeWindow) {
        throw new Error("onChangeFocusMode called with no active window");
      }

      const response = await messageActiveWindowManager<{ activeWindow: Types.ActiveWindow }>({
        type: "onChangeFocusMode",
        data: { windowId: activeWindow.windowId, enabled: e.target.checked },
      });

      setActiveWindow(response.activeWindow);
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
      const { activeWindowTabGroup } = await messageActiveWindowManager<{ activeWindowTabGroup: Types.ActiveWindowTabGroup }>({
        type: "onChangeKeepTabGroupOpen",
        data: { windowId, tabGroupId: currentActiveWindowTabGroupInfo.id, enabled: e.target.checked },
      });

      setCurrentActiveWindowTabGroupInfo(getCurrentActiveWindowTabGroupInfo(activeWindowTabGroup));
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
  } else {
    const currentWindowPreferences: UserPreferenceProps[] = [
      {
        name: "Enable Tidy Tab Groups",
        control: <Switch checked={activeWindow !== null} onChange={onChangeActivateCurrentWindow} />,
        enabled: activeWindow !== null,
      },
    ];

    if (activeWindow !== null) {
      const focusModeEnabled = activeWindow.focusMode !== null;
      currentWindowPreferences.push({
        name: "Focus Mode",
        control: <Switch checked={focusModeEnabled} onChange={onChangeFocusMode} />,
        enabled: focusModeEnabled,
      });
    }

    const currentTabGroupPreferences: UserPreferenceProps[] = [];
    if (currentActiveWindowTabGroupInfo && userPreferences!.collapseUnfocusedTabGroups) {
      currentTabGroupPreferences.push({
        name: "Keep open",
        control: <Switch checked={currentActiveWindowTabGroupInfo.keepOpen} onChange={onChangeKeepTabGroupOpen} />,
        enabled: currentActiveWindowTabGroupInfo.keepOpen,
      });
    }

    content = (
      <Box display="flex" flexDirection="column" gap={2}>
        <UserPreferenceCard title="Current Window" userPreferences={currentWindowPreferences} />
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

    const activeWindowTabGroup = await fetchActiveWindowTabGroup(activeTab.windowId, activeTab.groupId);
    return activeWindowTabGroup ? getCurrentActiveWindowTabGroupInfo(activeWindowTabGroup) : null;
  } catch (error) {
    throw new Error(myLogger.getPrefixedMessage(Misc.getErrorMessage(error)));
  }
}

async function fetchActiveWindow(windowId: Types.ChromeWindowId) {
  const myLogger = logger.createNestedLogger("fetchActiveWindow");
  try {
    const { activeWindow } = await messageActiveWindowManager<{ activeWindow: Types.ActiveWindow | undefined }>({
      type: "getActiveWindow",
      data: { windowId },
    });
    return activeWindow ?? null;
  } catch (error) {
    throw new Error(myLogger.getPrefixedMessage(Misc.getErrorMessage(error)));
  }
}

async function fetchActiveWindowTabGroup(windowId: Types.ChromeWindowId, tabGroupId: Types.ChromeTabGroupWithId["id"]) {
  const myLogger = logger.createNestedLogger("fetchActiveWindowTabGroup");
  try {
    const { activeWindowTabGroup } = await messageActiveWindowManager<{ activeWindowTabGroup: Types.ActiveWindowTabGroup | undefined }>({
      type: "getActiveWindowTabGroup",
      data: { windowId, tabGroupId },
    });

    return activeWindowTabGroup ?? null;
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

async function messageActiveWindowManager<R>(message: any): Promise<R> {
  const myLogger = logger.createNestedLogger("messageActiveWindowManager");
  try {
    const response = (await chrome.runtime.sendMessage(message)) as { error: unknown; data: R };
    if (response.error) {
      throw new Error("Active window manager message responded with an error: " + Misc.getErrorMessage(response.error));
    } else {
      return response.data;
    }
  } catch (error) {
    throw new Error(myLogger.getPrefixedMessage(Misc.getErrorMessage(error)));
  }
}

function getCurrentActiveWindowTabGroupInfo(activeWindowTabGroup: Types.ActiveWindowTabGroup) {
  return {
    id: activeWindowTabGroup.id,
    title: activeWindowTabGroup.title,
    color: activeWindowTabGroup.color,
    keepOpen: activeWindowTabGroup.keepOpen,
  };
}
