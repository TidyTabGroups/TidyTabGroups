import React from "react";
import { Typography, Grid } from "@mui/material";

export interface UserPreferenceProps {
  name: string;
  control: React.ReactElement;
}

export const UserPreference = (props: UserPreferenceProps) => {
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
