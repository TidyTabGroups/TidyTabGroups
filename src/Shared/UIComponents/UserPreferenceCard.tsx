import React from "react";
import { Typography, Card, CardContent, Container, Divider } from "@mui/material";
import { UserPreference, UserPreferenceProps } from "./UserPreference";

export interface UserPreferenceCardProps {
  title: string;
  userPreferences: UserPreferenceProps[];
}

export const UserPreferenceCard = (props: UserPreferenceCardProps) => {
  const { userPreferences, title } = props;

  return (
    <Container>
      <Typography variant="h5" component={"h1"} gutterBottom color="GrayText">
        {title}
      </Typography>
      <Card sx={{ borderRadius: "10px" }}>
        <CardContent
          sx={{
            display: "flex",
            flexDirection: "column",
            gap: "10px",
            ":last-child": { padding: "16px" },
          }}
        >
          {userPreferences.map((userPreference, index) => [
            <UserPreference {...userPreference} />,
            index === userPreferences.length - 1 ? null : <Divider />,
          ])}
        </CardContent>
      </Card>
    </Container>
  );
};
