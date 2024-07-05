import Logger from "../logger";
import { ChromeTabWithId, MouseInPageStatus } from "../types/types";
const logger = Logger.getLogger("MouseInPageTracker");

type OnChangeListener = (mouseInPageStatus: MouseInPageStatus, tab: ChromeTabWithId) => void;

let m_mouseInPageStatus: MouseInPageStatus = "left";
let m_didInitialize = false;
let m_onChangeListeners: OnChangeListener[] = [];

export async function initialize() {
  const myLogger = logger.getNestedLogger("initialize");
  if (m_didInitialize) {
    throw new Error(myLogger.getPrefixedMessage("MouseInPageTracker already initialized"));
  }

  try {
    const [activeTab] = (await chrome.tabs.query({ active: true, currentWindow: true })) as ChromeTabWithId[];
    if (activeTab) {
      m_mouseInPageStatus = await new Promise((resolve) => {
        chrome.tabs.sendMessage(activeTab.id, { type: "getMouseInPageStatus" }, (response) => {
          // If there is an error, then it means that there is no content script injected into this page. In this case we assume the mouse is not in the page.
          resolve(chrome.runtime.lastError ? "left" : response);
        });
      });
    }

    chrome.runtime.onMessage.addListener((msg, sender) => {
      const tab = sender.tab;
      if (!tab || msg.type !== "mouseInPageStatusChanged") {
        return;
      }

      m_mouseInPageStatus = msg.data;
      m_onChangeListeners.forEach((listener) => listener(m_mouseInPageStatus, tab as ChromeTabWithId));
    });

    m_didInitialize = true;
  } catch (error) {
    throw new Error(myLogger.getPrefixedMessage(`Failed to initialize MouseInPageTracker: ${error}`));
  }
}

export function getStatus() {
  throwIfNotInitialized("getStatus");
  return m_mouseInPageStatus;
}

export function isInPage() {
  throwIfNotInitialized("isInPage");
  return m_mouseInPageStatus === "entered" || m_mouseInPageStatus === "focused";
}

export function addOnChangeListener(listener: OnChangeListener) {
  throwIfNotInitialized("addOnChangeListener");
  m_onChangeListeners.push(listener);
}

export function removeOnChangeListener(listener: OnChangeListener) {
  throwIfNotInitialized("removeOnChangeListener");
  m_onChangeListeners = m_onChangeListeners.filter((l) => l !== listener);
}

function throwIfNotInitialized(messagePrefix: string) {
  if (!m_didInitialize) {
    throw new Error(messagePrefix + "::MouseInPageTracker is not initialized");
  }
}
