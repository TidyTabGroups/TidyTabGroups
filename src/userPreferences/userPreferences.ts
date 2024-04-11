import * as Storage from "../storage";
import { UserPreferences } from "../types/types";

export async function get() {
  const { userPreferences } = await Storage.getItems("userPreferences");
  return userPreferences;
}

export async function update(newPreferences: Partial<UserPreferences>) {
  const { userPreferences } = await Storage.updateItems(async (prev) => {
    prev.userPreferences = { ...prev.userPreferences, ...newPreferences };
    return prev;
  });
  return userPreferences;
}
