import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import * as Storage from "../storage";
import { UserSettings } from "../types/types";
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
  Input,
  Slider,
} from "@mui/material";

const UserSettings = () => {
  const [loadingSettings, setLoadingSettings] = useState(true);
  const [userSettings, setUserSettings] = useState<UserSettings | null>(null);

  const isLoading = userSettings === null;

  useEffect(() => {
    (async () => {
      const { userSettings } = await Storage.getItems("userSettings");
      setLoadingSettings(false);
      setUserSettings(userSettings);
    })();

    const subscription = Storage.changeStream.subscribe((changes) => {
      if (changes.userSettings?.newValue) {
        setUserSettings(changes.userSettings.newValue);
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  async function updateSettings(newSettings: Partial<UserSettings>) {
    await Storage.updateItems(async (prev) => {
      prev.userSettings = { ...prev.userSettings, ...newSettings };
      return prev;
    });
  }

  if (isLoading) {
    return null;
  }

  return (
    <Container maxWidth="md" sx={{ height: "100vh", padding: "24px" }}>
      <Typography variant="h6" gutterBottom>
        Behaviour
      </Typography>
      <Card sx={{ borderRadius: "10px" }}>
        <CardContent sx={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          <UserSetting
            control={<Switch checked={userSettings.repositionTabs} onChange={(e) => updateSettings({ repositionTabs: e.target.checked })} />}
            name="Reposition focused Tabs to the end"
          />
          <Divider />
          <UserSetting
            control={
              <Switch checked={userSettings.repositionTabGroups} onChange={(e) => updateSettings({ repositionTabGroups: e.target.checked })} />
            }
            name="Reposition focused Tab Groups to the end"
          />
          <Divider />
          <UserSetting
            control={
              <Switch
                checked={userSettings.addNewTabToFocusedTabGroup}
                onChange={(e) => updateSettings({ addNewTabToFocusedTabGroup: e.target.checked })}
              />
            }
            name="Automatically place new Tabs in focused Tab Group"
          />
          <Divider />
          <UserSetting
            control={
              <Switch
                checked={userSettings.collapseUnfocusedTabGroups}
                onChange={(e) => updateSettings({ collapseUnfocusedTabGroups: e.target.checked })}
              />
            }
            name="Automatically collapse unfocused Tab Groups"
          />
          <Divider />
          <UserSetting
            control={
              <Switch
                checked={userSettings.activateTabInFocusedTabGroup}
                onChange={(e) => updateSettings({ activateTabInFocusedTabGroup: e.target.checked })}
              />
            }
            name="Automatically activate Tab in focused Tab Group"
          />
        </CardContent>
      </Card>
    </Container>
  );
};

interface UserSettingProps {
  name: string;
  control: React.ReactElement;
}

const UserSetting = (props: UserSettingProps) => {
  const { name, control } = props;

  return (
    <Grid container spacing={2} alignItems="center" justifyContent="space-between">
      <Grid item>
        <Typography variant="h6" gutterBottom>
          {name}
        </Typography>
      </Grid>
      <Grid item xs sx={{ textAlign: "end" }}>
        {control}
      </Grid>
    </Grid>
  );
};

const App = () => {
  const prefersDarkMode = useMediaQuery("(prefers-color-scheme: dark)");

  const theme = React.useMemo(
    () =>
      createTheme({
        palette: {
          mode: prefersDarkMode ? "dark" : "light",
        },
      }),
    [prefersDarkMode]
  );

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
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
      <UserSettings />
    </ThemeProvider>
  );
};

const root = createRoot(document.getElementById("root")!);

root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
