import ChromeWindowMethods from "../../../Shared/ChromeWindowMethods";
import * as ActiveWindowModel from "../Model/Model";
import Types from "../../../Shared/Types";
import {
  ChromeTabGroupWithId,
  ChromeTabGroupId,
  ChromeTabId,
  ChromeTabWithId,
  ChromeWindowId,
  ChromeWindowWithId,
} from "../../../Shared/Types/Types";

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
    operation: (context: { activeWindow: Types.ActiveWindow; tabGroup: ChromeTabGroupWithId }) => Promise<void>,
    requiredPropertiesToMatch?: Partial<Record<keyof ChromeTabGroupWithId, any>>
  ) {
    const { isValid, activeWindow, tabGroupUpToDate } = await validateTabGroupUpToDateAndActiveWindow(tabGroupId, requiredPropertiesToMatch);
    if (!isValid) {
      return;
    }
  
    await operation({ activeWindow, tabGroup: tabGroupUpToDate });
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
  
  export async function validateTabUpToDateAndActiveWindow(
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
    const tabUpToDate = await ChromeWindowMethods.getIfTabExists(tabId);
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
  
    const activeWindow = await ActiveWindowModel.get(tabUpToDate.windowId);
    if (!activeWindow) {
      return { isValid: false, activeWindow: undefined, tabUpToDate: undefined };
    }
  
    return { isValid: true, activeWindow, tabUpToDate };
  }
  
  export async function validateTabGroupUpToDateAndActiveWindow(
    groupId: ChromeTabGroupId,
    requiredPropertiesToMatch?: Partial<Record<keyof ChromeTabGroupWithId, any>>
  ): Promise<
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
    const tabGroupUpToDate = await ChromeWindowMethods.getIfTabGroupExists(groupId);
    if (!tabGroupUpToDate) {
      return { isValid: false, activeWindow: undefined, tabGroupUpToDate: undefined };
    }
  
    if (requiredPropertiesToMatch) {
      for (const [key, value] of Object.entries(requiredPropertiesToMatch)) {
        if (tabGroupUpToDate[key as keyof ChromeTabGroupWithId] !== value) {
          return { isValid: false, activeWindow: undefined, tabGroupUpToDate: undefined };
        }
      }
    }
  
    const activeWindow = await ActiveWindowModel.get(tabGroupUpToDate.windowId);
    if (!activeWindow) {
      return { isValid: false, activeWindow: undefined, tabGroupUpToDate: undefined };
    }
  
    return { isValid: true, activeWindow, tabGroupUpToDate };
  }
  
  export async function validateWindowUpToDateAndActiveWindow(windowId: ChromeWindowId): Promise<
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
    const windowUpToDate = await ChromeWindowMethods.getIfWindowExists(windowId);
    if (!windowUpToDate) {
      return { isValid: false, activeWindow: undefined, windowUpToDate: undefined };
    }
  
    const activeWindow = await ActiveWindowModel.get(windowId);
    if (!activeWindow) {
      return { isValid: false, activeWindow: undefined, windowUpToDate: undefined };
    }
  
    return { isValid: true, activeWindow, windowUpToDate };
  }