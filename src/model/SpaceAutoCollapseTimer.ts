import { DataModel } from "../types";
import { v4 as uuidv4 } from "uuid";
import * as Storage from "../storage";
import { ActiveWindowSpace } from ".";
import Database from "../database";
import { IDBPTransaction, StoreNames } from "idb";

export namespace SpaceAutoCollapseTimer {
  export function create(activeWindowId: string, spaceId: string) {
    const id = uuidv4();
    const timerName = `spaceAutoCollapseTimer:${id}`;
    const when = Date.now() + 5000;
    chrome.alarms.create(timerName, { when });
    return {
      id,
      activeWindowId,
      spaceId,
      time: when,
    } as DataModel.SpaceAutoCollapseTimer;
  }

  export async function get(id: string) {
    const modelDB = await Database.getDBConnection<DataModel.ModelDB>("model");
    const timer = await modelDB.get("spaceAutoCollapseTimers", id);
    if (!timer) {
      throw new Error(`SpaceAutoCollapseTimer::get::Could not find timer with id ${id}`);
    }
    return timer;
  }

  export async function getAll() {
    const modelDB = await Database.getDBConnection<DataModel.ModelDB>("model");
    return await modelDB.getAll("spaceAutoCollapseTimers");
  }

  export async function add(
    timer: DataModel.SpaceAutoCollapseTimer,
    _transaction?: IDBPTransaction<DataModel.ModelDB, ["spaceAutoCollapseTimers", ...StoreNames<DataModel.ModelDB>[]], "readwrite">
  ) {
    const [transaction, didProvideTransaction] = await Database.useOrCreateTransaction(
      "model",
      _transaction,
      ["spaceAutoCollapseTimers"],
      "readwrite"
    );

    await transaction.objectStore("spaceAutoCollapseTimers").add(timer);

    if (!didProvideTransaction) {
      await transaction.done;
    }
  }

  export async function remove(
    id: string,
    _transaction?: IDBPTransaction<DataModel.ModelDB, ["spaceAutoCollapseTimers", ...StoreNames<DataModel.ModelDB>[]], "readwrite">
  ) {
    const [transaction, didProvideTransaction] = await Database.useOrCreateTransaction(
      "model",
      _transaction,
      ["spaceAutoCollapseTimers"],
      "readwrite"
    );

    await transaction.objectStore("spaceAutoCollapseTimers").delete(id);
    if (!didProvideTransaction) {
      await transaction.done;
    }
  }

  export async function startAutoCollapseTimerForSpace(
    activeWindowId: string,
    spaceId: string,
    _transaction?: IDBPTransaction<DataModel.ModelDB, ["spaceAutoCollapseTimers", ...StoreNames<DataModel.ModelDB>[]], "readwrite">
  ) {
    const timer = create(activeWindowId, spaceId);
    await add(timer, _transaction);

    return timer;
  }

  export async function onAutoCollapseTimer(id: string) {
    const autoCollapseTimer = await get(id);
    await ActiveWindowSpace.makePrimarySpace(autoCollapseTimer.activeWindowId, autoCollapseTimer.spaceId);
    await remove(id);
  }
}
