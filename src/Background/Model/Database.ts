import { IDBPTransaction, StoreNames } from "idb";
import Database from "../../Shared/Database";
import Types from "../../Shared/Types";

export async function getKey(
  id: Types.ModelDataBaseActiveWindow["windowId"],
  _transaction?: IDBPTransaction<
    Types.ModelDataBase,
    ["activeWindows", ...StoreNames<Types.ModelDataBase>[]],
    "readonly" | "readwrite"
  >
) {
  const [transaction] = await Database.useOrCreateTransaction(
    "model",
    _transaction,
    ["activeWindows"],
    "readonly"
  );
  return await transaction.objectStore("activeWindows").getKey(id);
}

export async function get(
  id: Types.ModelDataBaseActiveWindow["windowId"],
  _transaction?: IDBPTransaction<
    Types.ModelDataBase,
    ["activeWindows", ...StoreNames<Types.ModelDataBase>[]],
    "readonly" | "readwrite"
  >
) {
  const [transaction] = await Database.useOrCreateTransaction(
    "model",
    _transaction,
    ["activeWindows"],
    "readonly"
  );
  return await transaction.objectStore("activeWindows").get(id);
}

export async function getOrThrow(
  id: Types.ModelDataBaseActiveWindow["windowId"],
  _transaction?: IDBPTransaction<
    Types.ModelDataBase,
    ["activeWindows", ...StoreNames<Types.ModelDataBase>[]],
    "readonly" | "readwrite"
  >
) {
  const [transaction] = await Database.useOrCreateTransaction(
    "model",
    _transaction,
    ["activeWindows"],
    "readonly"
  );
  const activeWindow = await get(id, transaction);
  if (!activeWindow) {
    throw new Error(`Database::getOrThrow with id ${id} not found`);
  }
  return activeWindow;
}

export async function getAll(
  _transaction?: IDBPTransaction<
    Types.ModelDataBase,
    ["activeWindows", ...StoreNames<Types.ModelDataBase>[]],
    "readonly"
  >
) {
  const [transaction] = await Database.useOrCreateTransaction(
    "model",
    _transaction,
    ["activeWindows"],
    "readonly"
  );
  return await transaction.objectStore("activeWindows").getAll();
}

export async function add(
  activeWindow: Types.ModelDataBaseActiveWindow,
  _transaction?: IDBPTransaction<
    Types.ModelDataBase,
    ["activeWindows", ...StoreNames<Types.ModelDataBase>[]],
    "readwrite"
  >
) {
  const [transaction, didProvideTransaction] = await Database.useOrCreateTransaction(
    "model",
    _transaction,
    ["activeWindows"],
    "readwrite"
  );
  await transaction.objectStore("activeWindows").add(activeWindow);

  if (!didProvideTransaction) {
    await transaction.done;
  }

  return activeWindow;
}

export async function remove(
  id: Types.ModelDataBaseActiveWindow["windowId"],
  _transaction?: IDBPTransaction<
    Types.ModelDataBase,
    ["activeWindows", ...StoreNames<Types.ModelDataBase>[]],
    "readwrite"
  >
) {
  const [transaction, didProvideTransaction] = await Database.useOrCreateTransaction(
    "model",
    _transaction,
    ["activeWindows"],
    "readwrite"
  );

  const key = await transaction.objectStore("activeWindows").getKey(id);
  if (!key) {
    throw new Error(`Database::removeFromDatabase with id ${id} not found`);
  }

  await transaction.objectStore("activeWindows").delete(id);

  if (!didProvideTransaction) {
    await transaction.done;
  }
}

export async function update(
  id: Types.ActiveWindow["windowId"],
  // FIXME: use Partial<Types.ModelDataBaseActiveWindow> instead of Partial<Types.ActiveWindow>
  updatedProperties: Partial<Types.ActiveWindow>,
  _transaction?: IDBPTransaction<
    Types.ModelDataBase,
    ["activeWindows", ...StoreNames<Types.ModelDataBase>[]],
    "readwrite"
  >
) {
  const [transaction, didProvideTransaction] = await Database.useOrCreateTransaction(
    "model",
    _transaction,
    ["activeWindows"],
    "readwrite"
  );

  const activeWindow = await getOrThrow(id, transaction);

  await transaction.objectStore("activeWindows").put({ ...activeWindow, ...updatedProperties });

  if (!didProvideTransaction) {
    await transaction.done;
  }
}

export async function clear(
  _transaction?: IDBPTransaction<
    Types.ModelDataBase,
    ["activeWindows", ...StoreNames<Types.ModelDataBase>[]],
    "readwrite"
  >
) {
  const [transaction, didProvideTransaction] = await Database.useOrCreateTransaction(
    "model",
    _transaction,
    ["activeWindows"],
    "readwrite"
  );
  await transaction.objectStore("activeWindows").clear();

  if (!didProvideTransaction) {
    await transaction.done;
  }
}
