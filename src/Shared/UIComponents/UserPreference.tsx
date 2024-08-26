import React from "react";
import { Typography, Grid } from "@mui/material";

export interface UserPreferenceProps {
  name: string;
  control: React.ReactElement;
  enabled: boolean;
}

export const UserPreference = (props: UserPreferenceProps) => {
  const { name, control, enabled } = props;

  return (
    <Grid container spacing={2} alignItems="center" justifyContent="space-between">
      <Grid item>
        <Typography variant="h6" gutterBottom sx={{ opacity: enabled ? 1 : 0.5, transition: "opacity 0.3s ease-in-out" }}>
          {name}
        </Typography>
      </Grid>
      <Grid item xs sx={{ textAlign: "end" }}>
        {control}
      </Grid>
    </Grid>
  );
};
