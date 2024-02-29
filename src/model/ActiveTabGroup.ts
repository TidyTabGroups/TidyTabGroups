import Database from "../database";
import { ChromeTabGroupId } from "../types/types";
import { IDBPTransaction, StoreNames } from "idb";
import Types from "../types";
import * as ActiveWindow from "./ActiveWindow";

export async function get(
  id: ChromeTabGroupId,
  _transaction?: IDBPTransaction<Types.ModelDataBase, ["activeTabGroups", ...StoreNames<Types.ModelDataBase>[]], "readonly" | "readwrite">
) {
  const [transaction, didProvideTransaction] = await Database.useOrCreateTransaction("model", _transaction, ["activeTabGroups"], "readonly");
  const activeTabGroup = await transaction.objectStore("activeTabGroups").get(id);
  if (!activeTabGroup) {
    throw new Error(`ActiveTabGroup::activeTabGroup with id ${id} not found`);
  }

  if (!didProvideTransaction) {
    await transaction.done;
  }
  return activeTabGroup;
}

export async function add(
  tabGroup: chrome.tabGroups.TabGroup,
  _transaction?: IDBPTransaction<Types.ModelDataBase, ["activeTabGroups", ...StoreNames<Types.ModelDataBase>[]], "readwrite">
) {
  const [transaction, didProvideTransaction] = await Database.useOrCreateTransaction("model", _transaction, ["activeTabGroups"], "readwrite");
  await transaction.objectStore("activeTabGroups").add(tabGroup);

  if (!didProvideTransaction) {
    await transaction.done;
  }
}

export async function remove(
  id: ChromeTabGroupId,
  _transaction?: IDBPTransaction<Types.ModelDataBase, ["activeTabGroups", ...StoreNames<Types.ModelDataBase>[]], "readwrite">
) {
  const [transaction, didProvideTransaction] = await Database.useOrCreateTransaction("model", _transaction, ["activeTabGroups"], "readwrite");

  const key = await transaction.objectStore("activeTabGroups").getKey(id);
  if (!key) {
    throw new Error(`ActiveTabGroup::remove::activeTabGroup with id ${id} not found`);
  }

  await transaction.objectStore("activeTabGroups").delete(id);

  if (!didProvideTransaction) {
    await transaction.done;
  }
}
export async function update(
  id: ChromeTabGroupId,
  updatedProperties: Partial<Types.ActiveTabGroup>,
  _transaction?: IDBPTransaction<Types.ModelDataBase, ["activeTabGroups", ...StoreNames<Types.ModelDataBase>[]], "readwrite">
) {
  const [transaction, didProvideTransaction] = await Database.useOrCreateTransaction("model", _transaction, ["activeTabGroups"], "readwrite");

  const activeTabGroup = await get(id, transaction);

  await transaction.objectStore("activeTabGroups").put({ ...activeTabGroup, ...updatedProperties });

  if (!didProvideTransaction) {
    await transaction.done;
  }
}
