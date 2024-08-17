import ChromeWindowHelper from "../chromeWindowHelper";
import { ActiveWindow } from "../model";
import Types from "../types";
import { ChromeTabGroupWithId, ChromeTabGroupId, ChromeTabId, ChromeTabWithId, ChromeWindowId, ChromeWindowWithId } from "../types/types";

export async function runActiveWindowOperation(
  windowId: ChromeWindowId,
  operation: (activeWindow: Types.ActiveWindow, window: ChromeWindowWithId) => Promise<void>
) {
  const { isValid, activeWindow, windowUpToDate } = await validateWindowUpToDateAndActiveWindow(windowId);
  if (!isValid) {
    return;
  }

  await operation(activeWindow, windowUpToDate);
}

export async function runActiveWindowTabGroupOperation<T extends Partial<ChromeTabGroupWithId>>(
  tabGroupId: ChromeTabGroupId,
  operation: (context: {
    activeWindow: Types.ActiveWindow;
    tabGroup: ChromeTabGroupWithId;
    matchingTabGroupProperties: { [key in keyof T]: boolean };
  }) => Promise<void>,
  tabGroupPropertiesToMatch?: T | undefined
) {
  const { isValid, activeWindow, tabGroupUpToDate } = await validateTabGroupUpToDateAndActiveWindow(tabGroupId);
  if (!isValid) {
    return;
  }

  const matchingTabGroupProperties = {} as { [key in keyof T]: boolean };
  if (tabGroupPropertiesToMatch) {
    (Object.keys(tabGroupPropertiesToMatch) as (keyof T)[]).forEach((key) => {
      const propertyToMatch = tabGroupPropertiesToMatch[key];
      if (key in tabGroupUpToDate && tabGroupUpToDate[key as keyof ChromeTabGroupWithId] === propertyToMatch) {
        matchingTabGroupProperties[key] = true;
      } else {
        matchingTabGroupProperties[key] = false;
      }
    });
  }

  await operation({ activeWindow, tabGroup: tabGroupUpToDate, matchingTabGroupProperties });
}

export async function runActiveWindowTabOperation(
  tabId: ChromeTabId,
  operation: (context: { activeWindow: Types.ActiveWindow; tab: ChromeTabWithId }) => Promise<void>,
  requiredPropertiesToMatch?: Partial<Record<keyof ChromeTabWithId, any>>
) {
  const { isValid, activeWindow, tabUpToDate } = await validateTabUpToDateAndActiveWindow(tabId, requiredPropertiesToMatch);
  if (!isValid) {
    return;
  }

  await operation({ activeWindow, tab: tabUpToDate });
}

async function validateTabUpToDateAndActiveWindow(
  tabId: ChromeTabId,
  requiredPropertiesToMatch?: Partial<Record<keyof ChromeTabWithId, any>>
): Promise<
  | {
      isValid: true;
      activeWindow: Types.ActiveWindow;
      tabUpToDate: ChromeTabWithId;
    }
  | {
      isValid: false;
      activeWindow: undefined;
      tabUpToDate: undefined;
    }
> {
  const tabUpToDate = await ChromeWindowHelper.getIfTabExists(tabId);
  if (!tabUpToDate) {
    return { isValid: false, activeWindow: undefined, tabUpToDate: undefined };
  }

  if (requiredPropertiesToMatch) {
    for (const [key, value] of Object.entries(requiredPropertiesToMatch)) {
      if (tabUpToDate[key as keyof ChromeTabWithId] !== value) {
        return { isValid: false, activeWindow: undefined, tabUpToDate: undefined };
      }
    }
  }

  const activeWindow = await ActiveWindow.get(tabUpToDate.windowId);
  if (!activeWindow) {
    return { isValid: false, activeWindow: undefined, tabUpToDate: undefined };
  }

  return { isValid: true, activeWindow, tabUpToDate };
}

async function validateTabGroupUpToDateAndActiveWindow(groupId: ChromeTabGroupId): Promise<
  | {
      isValid: true;
      activeWindow: Types.ActiveWindow;
      tabGroupUpToDate: ChromeTabGroupWithId;
    }
  | {
      isValid: false;
      activeWindow: undefined;
      tabGroupUpToDate: undefined;
    }
> {
  const tabGroupUpToDate = await ChromeWindowHelper.getIfTabGroupExists(groupId);
  if (!tabGroupUpToDate) {
    return { isValid: false, activeWindow: undefined, tabGroupUpToDate: undefined };
  }

  const activeWindow = await ActiveWindow.get(tabGroupUpToDate.windowId);
  if (!activeWindow) {
    return { isValid: false, activeWindow: undefined, tabGroupUpToDate: undefined };
  }

  return { isValid: true, activeWindow, tabGroupUpToDate };
}

async function validateWindowUpToDateAndActiveWindow(windowId: ChromeWindowId): Promise<
  | {
      isValid: boolean;
      activeWindow: Types.ActiveWindow;
      windowUpToDate: ChromeWindowWithId;
    }
  | {
      isValid: false;
      activeWindow: undefined;
      windowUpToDate: undefined;
    }
> {
  const windowUpToDate = await ChromeWindowHelper.getIfWindowExists(windowId);
  if (!windowUpToDate) {
    return { isValid: false, activeWindow: undefined, windowUpToDate: undefined };
  }

  const activeWindow = await ActiveWindow.get(windowId);
  if (!activeWindow) {
    return { isValid: false, activeWindow: undefined, windowUpToDate: undefined };
  }

  return { isValid: true, activeWindow, windowUpToDate };
}
