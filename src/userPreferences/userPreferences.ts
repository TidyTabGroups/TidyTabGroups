import * as Storage from "../storage";
import { UserPreferences } from "../types/types";

interface UserPreferencesChanges {
  oldValue?: UserPreferences | undefined;
  newValue?: UserPreferences | undefined;
}

const onChangeListeners: Array<(changes: UserPreferencesChanges) => void> = [];

export function initialize() {
  Storage.changeStream.subscribe((changes) => {
    if (changes.userPreferences) {
      onChangeListeners.forEach((listener) => listener(changes.userPreferences!));
    }
  });
}

export function addChangeListener(listener: (changes: UserPreferencesChanges) => void) {
  onChangeListeners.push(listener);
}

export function removeChangeListener(listener: (changes: UserPreferencesChanges) => void) {
  const index = onChangeListeners.indexOf(listener);
  if (index !== -1) {
    onChangeListeners.splice(index, 1);
  }
}

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
