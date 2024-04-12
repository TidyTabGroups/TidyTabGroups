import { IDBPTransaction, StoreNames } from "idb";
import Database from "../database";
import Types from "../types";

export async function getKey(
  id: Types.ModelDataBaseActiveTabGroup["tabGroupId"],
  _transaction?: IDBPTransaction<Types.ModelDataBase, ["activeTabGroups", ...StoreNames<Types.ModelDataBase>[]], "readonly" | "readwrite">
) {
  const [transaction] = await Database.useOrCreateTransaction("model", _transaction, ["activeTabGroups"], "readonly");
  return await transaction.objectStore("activeTabGroups").getKey(id);
}

export async function get(
  id: Types.ModelDataBaseActiveTabGroup["tabGroupId"],
  _transaction?: IDBPTransaction<Types.ModelDataBase, ["activeTabGroups", ...StoreNames<Types.ModelDataBase>[]], "readonly" | "readwrite">
) {
  const [transaction] = await Database.useOrCreateTransaction("model", _transaction, ["activeTabGroups"], "readonly");
  return await transaction.objectStore("activeTabGroups").get(id);
}

export async function getAllByIndex(
  indexName: "windowId",
  key: Types.ModelDataBaseActiveTabGroup["windowId"],
  _transaction?: IDBPTransaction<Types.ModelDataBase, ["activeTabGroups", ...StoreNames<Types.ModelDataBase>[]], "readonly" | "readwrite">
) {
  const [transaction] = await Database.useOrCreateTransaction("model", _transaction, ["activeTabGroups"], "readonly");
  return await transaction.objectStore("activeTabGroups").index(indexName).getAll(key);
}

export async function getOrThrow(
  id: Types.ModelDataBaseActiveTabGroup["tabGroupId"],
  _transaction?: IDBPTransaction<Types.ModelDataBase, ["activeTabGroups", ...StoreNames<Types.ModelDataBase>[]], "readonly" | "readwrite">
) {
  const [transaction] = await Database.useOrCreateTransaction("model", _transaction, ["activeTabGroups"], "readonly");
  const activeWindow = await get(id, transaction);
  if (!activeWindow) {
    throw new Error(`ActiveTabGroupDatabase::getOrThrow with id ${id} not found`);
  }
  return activeWindow;
}

export async function getAll(
  _transaction?: IDBPTransaction<Types.ModelDataBase, ["activeTabGroups", ...StoreNames<Types.ModelDataBase>[]], "readonly">
) {
  const [transaction] = await Database.useOrCreateTransaction("model", _transaction, ["activeTabGroups"], "readonly");
  return await transaction.objectStore("activeTabGroups").getAll();
}

export async function add(
  activeWindow: Types.ModelDataBaseActiveTabGroup,
  _transaction?: IDBPTransaction<Types.ModelDataBase, ["activeTabGroups", ...StoreNames<Types.ModelDataBase>[]], "readwrite">
) {
  const [transaction, didProvideTransaction] = await Database.useOrCreateTransaction("model", _transaction, ["activeTabGroups"], "readwrite");
  await transaction.objectStore("activeTabGroups").add(activeWindow);

  if (!didProvideTransaction) {
    await transaction.done;
  }

  return activeWindow;
}

export async function remove(
  id: Types.ModelDataBaseActiveTabGroup["tabGroupId"],
  _transaction?: IDBPTransaction<Types.ModelDataBase, ["activeTabGroups", ...StoreNames<Types.ModelDataBase>[]], "readwrite">
) {
  const [transaction, didProvideTransaction] = await Database.useOrCreateTransaction("model", _transaction, ["activeTabGroups"], "readwrite");

  const key = await transaction.objectStore("activeTabGroups").getKey(id);
  if (!key) {
    throw new Error(`ActiveTabGroupDatabase::removeFromDatabase with id ${id} not found`);
  }

  await transaction.objectStore("activeTabGroups").delete(id);

  if (!didProvideTransaction) {
    await transaction.done;
  }
}

export async function update(
  id: Types.ActiveTabGroup["tabGroupId"],
  updatedProperties: Partial<Types.ModelDataBaseActiveTabGroup>,
  _transaction?: IDBPTransaction<Types.ModelDataBase, ["activeTabGroups", ...StoreNames<Types.ModelDataBase>[]], "readwrite">
) {
  const [transaction, didProvideTransaction] = await Database.useOrCreateTransaction("model", _transaction, ["activeTabGroups"], "readwrite");

  const activeWindow = await getOrThrow(id, transaction);

  await transaction.objectStore("activeTabGroups").put({ ...activeWindow, ...updatedProperties });

  if (!didProvideTransaction) {
    await transaction.done;
  }
}

export async function clear(
  _transaction?: IDBPTransaction<Types.ModelDataBase, ["activeTabGroups", ...StoreNames<Types.ModelDataBase>[]], "readwrite">
) {
  const [transaction, didProvideTransaction] = await Database.useOrCreateTransaction("model", _transaction, ["activeTabGroups"], "readwrite");
  await transaction.objectStore("activeTabGroups").clear();

  if (!didProvideTransaction) {
    await transaction.done;
  }
}
