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
    <Container maxWidth="md" sx={{ height: "100vh", padding: "24px" }}>
      <Typography variant="h6" component={"h1"} gutterBottom color="GrayText">
        Behaviour
      </Typography>
      <Card sx={{ borderRadius: "10px" }}>
        <CardContent sx={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          <UserPreference
            control={<Switch checked={userPreferences.repositionTabs} onChange={(e) => updatePreferences({ repositionTabs: e.target.checked })} />}
            name="Reposition focused Tabs to the end"
          />
          <Divider />
          <UserPreference
            control={
              <Switch checked={userPreferences.repositionTabGroups} onChange={(e) => updatePreferences({ repositionTabGroups: e.target.checked })} />
            }
            name="Reposition focused Tab Groups to the end"
          />
          <Divider />
          <UserPreference
            control={
              <Switch
                checked={userPreferences.addNewTabToFocusedTabGroup}
                onChange={(e) => updatePreferences({ addNewTabToFocusedTabGroup: e.target.checked })}
              />
            }
            name="Automatically place new Tabs in focused Tab Group"
          />
          <Divider />
          <UserPreference
            control={
              <Switch
                checked={userPreferences.collapseUnfocusedTabGroups}
                onChange={(e) => updatePreferences({ collapseUnfocusedTabGroups: e.target.checked })}
              />
            }
            name="Automatically collapse unfocused Tab Groups"
          />
          <Divider />
          <UserPreference
            control={
              <Switch
                checked={userPreferences.activateTabInFocusedTabGroup}
                onChange={(e) => updatePreferences({ activateTabInFocusedTabGroup: e.target.checked })}
              />
            }
            name="Automatically activate Tab in focused Tab Group"
          />
        </CardContent>
      </Card>
    </Container>
  );
};

interface UserPreferenceProps {
  name: string;
  control: React.ReactElement;
}

const UserPreference = (props: UserPreferenceProps) => {
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
      <UserPreferences />
    </ThemeProvider>
  );
};

const root = createRoot(document.getElementById("root")!);

root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
