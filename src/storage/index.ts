import Misc from "../misc";
import { LocalStorageShape } from "../types/types";
let initializingPromise = new Misc.NonRejectablePromise<void>();
let initializing: Promise<void> | null = null;

async function waitForInitialization() {
  if (initializing === null) {
    throw new Error("Storage has not been initialized");
  }
  await initializing;
}

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
  initializing = initializingPromise.getPromise();
  const keys = Object.keys(defaultValues) as (keyof LocalStorageShape)[];
  const items = await chrome.storage.local.get(keys);
  const missingItems = keys.filter((key) => !items.hasOwnProperty(key));
  const newItems = missingItems.reduce((acc, key) => ({ ...acc, [key]: defaultValues[key] }), {});
  await chrome.storage.local.set(newItems);
  initializingPromise.resolve();
}

export async function getItems<T extends keyof LocalStorageShape>(keys: T | T[] | null) {
  await waitForInitialization();
  return chrome.storage.local.get(keys) as Promise<Pick<LocalStorageShape, T>>;
}

export async function setItems(items: Partial<LocalStorageShape>) {
  await waitForInitialization();
  return chrome.storage.local.set(items);
}

export async function clearItems() {
  await waitForInitialization();
  return chrome.storage.local.clear();
}

export async function removeItems(keys: (keyof LocalStorageShape)[]) {
  await waitForInitialization();
  return chrome.storage.local.remove(keys);
}

export async function updateItems<T extends keyof LocalStorageShape, P extends { [key in T]: LocalStorageShape[T] }>(
  keys: T | T[],
  updater: (items: P) => Promise<P> | P
) {
  await waitForInitialization();
  const items = await getItems(keys);
  const newItems = await updater(items as P);
  await setItems(newItems);
  return newItems;
}

export async function addChangeListener<T extends keyof LocalStorageShape>(
  listener: (changes: { [key in T]?: { newValue?: LocalStorageShape[key]; oldValue?: LocalStorageShape[key] } }) => void
) {
  await waitForInitialization();
  chrome.storage.onChanged.addListener(listener as (changes: { [key in keyof LocalStorageShape]?: chrome.storage.StorageChange }) => void);
}

export async function removeChangeListener<T extends keyof LocalStorageShape>(
  listener: (changes: { [key in T]?: { newValue?: LocalStorageShape[key]; oldValue?: LocalStorageShape[key] } }) => void
) {
  await waitForInitialization();
  chrome.storage.onChanged.removeListener(listener as (changes: { [key in keyof LocalStorageShape]?: chrome.storage.StorageChange }) => void);
}
