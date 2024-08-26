import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { Container, Typography, Button } from "@mui/material";
import { App } from "../Shared/UIComponents";
import Logger from "../Shared/Logger";
import Storage from "../Shared/Storage";

const logger = Logger.createLogger("ErrorPopup");

const ErrorPopup = () => {
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    Storage.start().then(() => {
      Storage.getItems(["lastError"]).then((result) => {
        if (result.lastError) {
          setErrorMessage(result.lastError);
        }
      });
    });
  }, []);

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
      {errorMessage && (
        <Typography variant="body1" paragraph sx={{ overflowWrap: "anywhere" }}>
          {errorMessage}
        </Typography>
      )}
      <Typography variant="body1" paragraph>
        Please try reloading the extension.
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
