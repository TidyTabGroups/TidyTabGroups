import Misc from "../misc";
import { LocalStorageShape } from "../types/types";
let readyPromise = new Misc.NonRejectablePromise<void>();
let ready = readyPromise.getPromise();

async function waitForReady() {
  await ready;
}

export async function start() {
  readyPromise.resolve();
}

export async function getItems<T extends keyof LocalStorageShape>(keys: T | T[] | null) {
  await waitForReady();
  return chrome.storage.local.get(keys) as Promise<Pick<LocalStorageShape, T>>;
}

export async function setItems(items: Partial<LocalStorageShape>) {
  await waitForReady();
  return chrome.storage.local.set(items);
}

export async function clearItems() {
  await waitForReady();
  return chrome.storage.local.clear();
}

export async function removeItems(keys: (keyof LocalStorageShape)[]) {
  await waitForReady();
  return chrome.storage.local.remove(keys);
}

export async function updateItems<T extends keyof LocalStorageShape, P extends { [key in T]: LocalStorageShape[T] }>(
  keys: T | T[],
  updater: (items: P) => Promise<P> | P
) {
  await waitForReady();
  const items = await getItems(keys);
  const newItems = await updater(items as P);
  await setItems(newItems);
  return newItems;
}

export async function addChangeListener<T extends keyof LocalStorageShape>(
  listener: (changes: { [key in T]?: { newValue: LocalStorageShape[key]; oldValue: LocalStorageShape[key] } }) => void
) {
  await waitForReady();
  chrome.storage.onChanged.addListener(listener as (changes: { [key in keyof LocalStorageShape]?: chrome.storage.StorageChange }) => void);
}

export async function removeChangeListener<T extends keyof LocalStorageShape>(
  listener: (changes: { [key in T]?: { newValue?: LocalStorageShape[key]; oldValue?: LocalStorageShape[key] } }) => void
) {
  await waitForReady();
  chrome.storage.onChanged.removeListener(listener as (changes: { [key in keyof LocalStorageShape]?: chrome.storage.StorageChange }) => void);
}
