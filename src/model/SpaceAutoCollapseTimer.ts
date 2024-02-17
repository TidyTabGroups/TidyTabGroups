import { DataModel } from "../types";
import { v4 as uuidv4 } from "uuid";
import * as Storage from "../storage";

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

  export async function get(timerId: string) {
    const spaceAutoCollapseTimers = await getAll();
    return spaceAutoCollapseTimers.find((timer) => timer.id === timerId);
  }

  export async function getAll() {
    const result = await Storage.getGuaranteedItems<{
      spaceAutoCollapseTimers: DataModel.Model["spaceAutoCollapseTimers"];
    }>("spaceAutoCollapseTimers");
    return result.spaceAutoCollapseTimers;
  }

  export async function set(timer: DataModel.SpaceAutoCollapseTimer) {
    const prevSpaceAutoCollapseTimers = await getAll();
    await setAll([...prevSpaceAutoCollapseTimers, timer]);
  }

  export async function setAll(timers: DataModel.Model["spaceAutoCollapseTimers"]) {
    await Storage.setItems({ spaceAutoCollapseTimers: timers });
  }

  export async function startAutoCollapseTimerForSpace(activeWindowId: string, spaceId: string) {
    const timer = create(activeWindowId, spaceId);
    await set(timer);
    return timer;
  }
}
