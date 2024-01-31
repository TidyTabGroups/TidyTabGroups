import { LocalStorage } from "../../types";

export const LOCAL_STORAGE_DEFAULT_VALUES: LocalStorage = {
  activeWindows: [],
  spaceAutoCollapseTimers: [],
};

export async function getItems<T extends Partial<LocalStorage>>(
  keys?: string | string[] | { [key: string]: any } | null
) {
  return (await chrome.storage.local.get(keys)) as T;
}

export async function setItems<T extends Partial<LocalStorage>>(items: T) {
  await chrome.storage.local.set(items);
}

export async function getGuaranteedItems<T extends Partial<LocalStorage>>(...keys: (keyof T)[]) {
  const result = (await chrome.storage.local.get(keys)) as T;
  let defaultValues: Partial<LocalStorage> = {};

  keys.forEach((key) => {
    if (result[key] === undefined) {
      // FIXME: I think the compiler is not recognizing the correlation between defaultValues and LOCAL_STORAGE_DEFAULT_VALUES
      // @ts-ignore
      defaultValues[key] = LOCAL_STORAGE_DEFAULT_VALUES[key];
    }
  });

  if (Object.keys(defaultValues).length > 0) {
    await chrome.storage.local.set(defaultValues);
    return { ...result, ...defaultValues };
  }

  return result;
}

export async function useOrGetItems<T extends Partial<LocalStorage>>(keys: Partial<T> = {}) {
  const missingValues: (keyof T)[] = [];
  for (const key in keys) {
    if (keys[key] === undefined) {
      missingValues.push(key);
    }
  }

  if (missingValues.length > 0) {
    const defaultValues = await getGuaranteedItems(...missingValues);
    return { ...keys, ...defaultValues };
  }
  return keys;
}

export async function useOrGetItem<T extends keyof LocalStorage>(
  key: T,
  value: LocalStorage[T] | undefined
) {
  let result: LocalStorage[T] | undefined = value;
  if (result === undefined) {
    result = (await getGuaranteedItems(key))[key];
  }

  if (result === undefined) {
    throw new Error(`useOrGetItem: result for ${key} is undefined`);
  }

  return result;
}
