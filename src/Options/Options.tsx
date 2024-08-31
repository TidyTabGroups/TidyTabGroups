import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import Storage from "../Shared/Storage";
import { UserPreferences } from "../Shared/Types/Types";
import { Switch, Container, Typography, AppBar, Toolbar } from "@mui/material";
import { App, FixedPageTypeSelect, UserPreferenceCard, UserPreferenceProps } from "../Shared/UIComponents";

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

  const otherUserPreferences: UserPreferenceProps[] = [
    {
      name: "Reload on error",
      control: <Switch checked={userPreferences.reloadOnError} onChange={(e) => updatePreferences({ reloadOnError: e.target.checked })} />,
      enabled: userPreferences.reloadOnError,
    },
  ];

  if (process.env.NODE_ENV === "development") {
    otherUserPreferences.push(
      {
        name: "Create dummy tab on startup",
        control: (
          <FixedPageTypeSelect
            value={userPreferences.createDummyFixedPageOnStartup.type}
            onChangeType={(value) =>
              updatePreferences({
                createDummyFixedPageOnStartup: { ...userPreferences.createDummyFixedPageOnStartup, type: value },
              })
            }
            onChangeEnabled={(value) =>
              updatePreferences({
                createDummyFixedPageOnStartup: { ...userPreferences.createDummyFixedPageOnStartup, enabled: value },
              })
            }
            enabled={userPreferences.createDummyFixedPageOnStartup.enabled}
          />
        ),
        enabled: userPreferences.createDummyFixedPageOnStartup.enabled,
      },
      {
        name: "Create options page tab on startup",
        control: (
          <FixedPageTypeSelect
            value={userPreferences.createOptionsFixedPageOnStartup.type}
            onChangeType={(value) =>
              updatePreferences({
                createOptionsFixedPageOnStartup: { ...userPreferences.createOptionsFixedPageOnStartup, type: value },
              })
            }
            onChangeEnabled={(value) =>
              updatePreferences({
                createOptionsFixedPageOnStartup: { ...userPreferences.createOptionsFixedPageOnStartup, enabled: value },
              })
            }
            enabled={userPreferences.createOptionsFixedPageOnStartup.enabled}
          />
        ),
        enabled: userPreferences.createOptionsFixedPageOnStartup.enabled,
      }
    );
  }

  return (
    <Container maxWidth="md" sx={{ height: "100vh", padding: "24px", gap: "20px", display: "flex", flexDirection: "column" }}>
      <UserPreferenceCard
        userPreferences={[
          {
            name: "Reposition focused Tabs to the end",
            control: <Switch checked={userPreferences.repositionTabs} onChange={(e) => updatePreferences({ repositionTabs: e.target.checked })} />,
            enabled: userPreferences.repositionTabs,
          },
          {
            name: "Reposition focused Tab Groups to the end",
            control: (
              <Switch checked={userPreferences.repositionTabGroups} onChange={(e) => updatePreferences({ repositionTabGroups: e.target.checked })} />
            ),
            enabled: userPreferences.repositionTabGroups,
          },
          {
            name: "Always group Tabs",
            control: <Switch checked={userPreferences.alwaysGroupTabs} onChange={(e) => updatePreferences({ alwaysGroupTabs: e.target.checked })} />,
            enabled: userPreferences.alwaysGroupTabs,
          },
          {
            name: "Automatically collapse unfocused Tab Groups",
            control: (
              <Switch
                checked={userPreferences.collapseUnfocusedTabGroups}
                onChange={(e) => updatePreferences({ collapseUnfocusedTabGroups: e.target.checked })}
              />
            ),
            enabled: userPreferences.collapseUnfocusedTabGroups,
          },
          {
            name: "Automatically activate Tab in focused Tab Group",
            control: (
              <Switch
                checked={userPreferences.activateTabInFocusedTabGroup}
                onChange={(e) => updatePreferences({ activateTabInFocusedTabGroup: e.target.checked })}
              />
            ),
            enabled: userPreferences.activateTabInFocusedTabGroup,
          },
          {
            name: "Enable Focus Mode for newly created windows",
            control: (
              <Switch
                checked={userPreferences.enableFocusModeForNewWindows}
                onChange={(e) => updatePreferences({ enableFocusModeForNewWindows: e.target.checked })}
              />
            ),
            enabled: userPreferences.enableFocusModeForNewWindows,
          },
          {
            name: "Highlight previous active Tab Group",
            control: (
              <Switch
                checked={userPreferences.highlightPrevActiveTabGroup}
                onChange={(e) => updatePreferences({ highlightPrevActiveTabGroup: e.target.checked })}
              />
            ),
            enabled: userPreferences.highlightPrevActiveTabGroup,
          },
        ]}
        title="Functionality"
      />
      <UserPreferenceCard userPreferences={otherUserPreferences} title="Other" />
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
            Tidy Tab Groups - Settings
          </Typography>
        </Toolbar>
      </Container>
    </AppBar>
    <UserPreferences />
  </App>
);
