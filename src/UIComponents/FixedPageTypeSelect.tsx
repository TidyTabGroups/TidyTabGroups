import React, { useState } from "react";
import { Select, MenuItem, Switch } from "@mui/material";
import { FixedPageType } from "../types/types";

interface FixedPageTypeSelectProps {
  value: FixedPageType;
  onChangeType: (value: FixedPageType) => void;
  onChangeEnabled: (value: boolean) => void;
  enabled: boolean;
}

export default function FixedPageTypeSelect({ value, onChangeType, onChangeEnabled, enabled }: FixedPageTypeSelectProps) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "10px", justifyContent: "end" }}>
      <Select value={value} onChange={(e) => onChangeType(e.target.value as FixedPageType)} disabled={!enabled}>
        <MenuItem value="tab">Tab</MenuItem>
        <MenuItem value="pinnedTab">Pinned Tab</MenuItem>
        <MenuItem value="popupWindow">Popup Window</MenuItem>
      </Select>
      <Switch checked={enabled} onChange={(e) => onChangeEnabled(e.target.checked)} />
    </div>
  );
}
