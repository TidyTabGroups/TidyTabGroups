import { LocalStorageShape } from "../types/types";
import { getBucket } from "@extend-chrome/storage";
const store = getBucket<LocalStorageShape>("store");

export const LOCAL_STORAGE_DEFAULT_VALUES: LocalStorageShape = {
  userSettings: {
    repositionTabs: true,
    repositionTabGroups: true,
    addNewTabToFocusedTabGroup: true,
    collapseUnfocusedTabGroups: true,
    activateTabInFocusedTabGroup: true,
  },
};

export async function initialize(defaultValues = LOCAL_STORAGE_DEFAULT_VALUES) {
  await setItems(defaultValues);
}

export const getItems = store.get;
export const setItems = store.set;
export const clearItems = store.clear;
export const removeItems = store.remove;
export const updateItems = store.update;
export const changeStream = store.changeStream;
export const valueStream = store.valueStream;

updateItems(async (prev) => {
  return prev;
});
