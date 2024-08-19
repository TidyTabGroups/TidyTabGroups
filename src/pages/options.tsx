import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import * as Storage from "../storage";
import { UserPreferences } from "../types/types";
import {
  Switch,
  Container,
  Divider,
  createTheme,
  ThemeProvider,
  useMediaQuery,
  Card,
  Typography,
  CssBaseline,
  CardContent,
  AppBar,
  Toolbar,
  Grid,
} from "@mui/material";
import { UserPreference } from "./userPreference";
import { App } from "./app";
import { UserPreferenceCard } from "./userPreference/UserPreferenceCard";

Storage.start();

const UserPreferences = () => {
  const [loadingPreferences, setLoadingPreferences] = useState(true);
  const [userPreferences, setUserPreferences] = useState<UserPreferences | null>(null);

  const isLoading = userPreferences === null;

  useEffect(() => {
    (async () => {
      const { userPreferences } = await Storage.getItems("userPreferences");
      setLoadingPreferences(false);
      setUserPreferences(userPreferences);
    })();

    Storage.addChangeListener(onChangeUserPreferences);

    function onChangeUserPreferences(changes: { userPreferences?: { newValue?: UserPreferences; oldValue?: UserPreferences } }) {
      if (changes.userPreferences?.newValue) {
        setUserPreferences(changes.userPreferences.newValue);
      }
    }

    return () => {
      Storage.removeChangeListener(onChangeUserPreferences);
    };
  }, []);

  async function updatePreferences(newPreferences: Partial<UserPreferences>) {
    await Storage.updateItems("userPreferences", async (prev) => {
      prev.userPreferences = { ...prev.userPreferences, ...newPreferences };
      return prev;
    });
  }

  if (isLoading) {
    return null;
  }

  return (
    <Container maxWidth="md" sx={{ height: "100vh", padding: "24px", gap: "20px", display: "flex", flexDirection: "column" }}>
      <UserPreferenceCard
        userPreferences={[
          {
            name: "Reposition focused Tabs to the end",
            control: <Switch checked={userPreferences.repositionTabs} onChange={(e) => updatePreferences({ repositionTabs: e.target.checked })} />,
          },
          {
            name: "Reposition focused Tab Groups to the end",
            control: (
              <Switch checked={userPreferences.repositionTabGroups} onChange={(e) => updatePreferences({ repositionTabGroups: e.target.checked })} />
            ),
          },
          {
            name: "Always group Tabs",
            control: <Switch checked={userPreferences.alwaysGroupTabs} onChange={(e) => updatePreferences({ alwaysGroupTabs: e.target.checked })} />,
          },
          {
            name: "Automatically collapse unfocused Tab Groups",
            control: (
              <Switch
                checked={userPreferences.collapseUnfocusedTabGroups}
                onChange={(e) => updatePreferences({ collapseUnfocusedTabGroups: e.target.checked })}
              />
            ),
          },
          {
            name: "Automatically activate Tab in focused Tab Group",
            control: (
              <Switch
                checked={userPreferences.activateTabInFocusedTabGroup}
                onChange={(e) => updatePreferences({ activateTabInFocusedTabGroup: e.target.checked })}
              />
            ),
          },
        ]}
        title="Functionality"
      />
    </Container>
  );
};

const root = createRoot(document.getElementById("root")!);

root.render(
  <App>
    <AppBar position="sticky">
      <Container maxWidth="xl">
        <Toolbar disableGutters>
          <Typography
            variant="h6"
            noWrap
            component="a"
            href="#app-bar-with-responsive-menu"
            sx={{
              mr: 2,
              display: { xs: "none", md: "flex" },
              fontFamily: "monospace",
              fontWeight: 700,
              letterSpacing: ".3rem",
              color: "inherit",
              textDecoration: "none",
            }}
          >
            TIDY TABS SETTINGS
          </Typography>
        </Toolbar>
      </Container>
    </AppBar>
    <UserPreferences />
  </App>
);
