import Database from "../database";
import { ChromeTabGroupId, ChromeWindowId } from "../types/types";
import { IDBPTransaction, IndexKey, IndexNames, StoreNames } from "idb";
import Types from "../types";
import { v4 as uuidv4 } from "uuid";
import Misc from "../misc";

export async function get(
  id: string,
  _transaction?: IDBPTransaction<
    Types.ModelDataBase,
    ["activeTabGroupAutoCollapseTimers", ...StoreNames<Types.ModelDataBase>[]],
    "readonly" | "readwrite"
  >
) {
  const [transaction, didProvideTransaction] = await Database.useOrCreateTransaction(
    "model",
    _transaction,
    ["activeTabGroupAutoCollapseTimers"],
    "readonly"
  );
  const activeTabGroupAutoCollapseTimer = await transaction.objectStore("activeTabGroupAutoCollapseTimers").get(id);
  if (!activeTabGroupAutoCollapseTimer) {
    throw new Error(`ActiveTabGroupAutoCollapseTimer::activeTabGroupAutoCollapseTimer with id ${id} not found`);
  }

  if (!didProvideTransaction) {
    await transaction.done;
  }
  return activeTabGroupAutoCollapseTimer;
}

export async function getFromIndex<IndexName extends IndexNames<Types.ModelDataBase, "activeTabGroupAutoCollapseTimers">>(
  index: IndexName,
  query: IndexKey<Types.ModelDataBase, "activeTabGroupAutoCollapseTimers", IndexName> | IDBKeyRange,
  _transaction?: IDBPTransaction<
    Types.ModelDataBase,
    ["activeTabGroupAutoCollapseTimers", ...StoreNames<Types.ModelDataBase>[]],
    "readonly" | "readwrite"
  >
) {
  const [transaction] = await Database.useOrCreateTransaction("model", _transaction, ["activeTabGroupAutoCollapseTimers"], "readonly");
  return await transaction.objectStore("activeTabGroupAutoCollapseTimers").index(index).get(query);
}

export async function add(
  activeTabGroupAutoCollapseTimer: Types.ActiveTabGroupAutoCollapseTimer,
  _transaction?: IDBPTransaction<Types.ModelDataBase, ["activeTabGroupAutoCollapseTimers", ...StoreNames<Types.ModelDataBase>[]], "readwrite">
) {
  const [transaction, didProvideTransaction] = await Database.useOrCreateTransaction(
    "model",
    _transaction,
    ["activeTabGroupAutoCollapseTimers"],
    "readwrite"
  );
  await transaction.objectStore("activeTabGroupAutoCollapseTimers").add(activeTabGroupAutoCollapseTimer);

  if (!didProvideTransaction) {
    await transaction.done;
  }

  return activeTabGroupAutoCollapseTimer;
}

export async function remove(
  id: string,
  _transaction?: IDBPTransaction<Types.ModelDataBase, ["activeTabGroupAutoCollapseTimers", ...StoreNames<Types.ModelDataBase>[]], "readwrite">
) {
  const [transaction, didProvideTransaction] = await Database.useOrCreateTransaction(
    "model",
    _transaction,
    ["activeTabGroupAutoCollapseTimers"],
    "readwrite"
  );

  const key = await transaction.objectStore("activeTabGroupAutoCollapseTimers").getKey(id);
  if (!key) {
    throw new Error(`ActiveTabGroupAutoCollapseTimer::remove::activeTabGroupAutoCollapseTimer with id ${id} not found`);
  }

  await transaction.objectStore("activeTabGroupAutoCollapseTimers").delete(id);

  if (!didProvideTransaction) {
    await transaction.done;
  }
}

export async function startAutoCollapseTimerForTabGroup(
  tabGroupId: ChromeTabGroupId,
  windowId: ChromeWindowId,
  _transaction?: IDBPTransaction<Types.ModelDataBase, ["activeTabGroupAutoCollapseTimers", ...StoreNames<Types.ModelDataBase>[]], "readwrite">
) {
  const timerName = `${Misc.ACTIVE_TAB_GROUP_AUTO_COLLAPSE_TIMER_BASE_NAME}:${tabGroupId}`;
  chrome.alarms.create(timerName, {
    when: Date.now() + Misc.ACTIVE_TAB_GROUP_AUTO_COLLAPSE_TIMER_DURATION,
  });

  try {
    const [transaction, didProvideTransaction] = await Database.useOrCreateTransaction(
      "model",
      _transaction,
      ["activeTabGroupAutoCollapseTimers"],
      "readwrite"
    );

    const activeTabGroupAutoCollapseTimer = await transaction.objectStore("activeTabGroupAutoCollapseTimers").index("tabGroupId").get(tabGroupId);
    if (activeTabGroupAutoCollapseTimer) {
      throw new Error(
        `ActiveTabGroupAutoCollapseTimer::startAutoCollapseTimerForTabGroup::activeTabGroupAutoCollapseTimer with id ${tabGroupId} already exists`
      );
    }

    const newActiveTabGroupAutoCollapseTimer = await add({ id: uuidv4(), tabGroupId, windowId }, transaction);

    if (!didProvideTransaction) {
      await transaction.done;
    }

    return newActiveTabGroupAutoCollapseTimer;
  } catch (error) {
    chrome.alarms.clear(timerName);
    throw new Error(`ActiveTabGroupAutoCollapseTimer::startAutoCollapseTimerForTabGroup::error: ${error}`);
  }
}
