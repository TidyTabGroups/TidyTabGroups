import React from "react";
import { createRoot } from "react-dom/client";
import { Container, Typography, Button } from "@mui/material";
import { App } from "./app";
import Logger from "../logger";

const logger = Logger.createLogger("ErrorPopup");

const ErrorPopup = () => {
  const handleReload = () => {
    chrome.runtime.reload();
  };

  return (
    <Container
      maxWidth="sm"
      sx={{
        padding: "24px",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Typography variant="h5" gutterBottom color="error">
        An error occurred
      </Typography>
      <Typography variant="body1" paragraph>
        Tidy Tabs encountered an unexpected error. Please try reloading the extension.
      </Typography>
      <Button variant="contained" color="primary" onClick={handleReload}>
        Reload Extension
      </Button>
    </Container>
  );
};

const root = createRoot(document.getElementById("root")!);
root.render(
  <App>
    <ErrorPopup />
  </App>
);
