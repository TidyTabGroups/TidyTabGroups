import { LocalStorageShape } from "../types/types";
import { getBucket } from "@extend-chrome/storage";
const store = getBucket<LocalStorageShape>("store");

export const LOCAL_STORAGE_DEFAULT_VALUES: LocalStorageShape = {
  userPreferences: {
    repositionTabs: false,
    repositionTabGroups: false,
    addNewTabToFocusedTabGroup: true,
    collapseUnfocusedTabGroups: true,
    activateTabInFocusedTabGroup: true,
  },
};

export async function initialize(defaultValues = LOCAL_STORAGE_DEFAULT_VALUES) {
  const items = await getItems();
  const missingItems = (Object.keys(defaultValues) as (keyof LocalStorageShape)[]).filter((key) => !items[key]);
  const newItems = missingItems.reduce((acc, key) => ({ ...acc, [key]: defaultValues[key] }), {});
  await setItems(newItems);
}

export const getItems = store.get;
export const setItems = store.set;
export const clearItems = store.clear;
export const removeItems = store.remove;
export const updateItems = store.update;
export const changeStream = store.changeStream;
export const valueStream = store.valueStream;
