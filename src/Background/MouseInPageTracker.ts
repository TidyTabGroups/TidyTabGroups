import Logger from "../Shared/Logger";
import { ChromeTabWithId, MouseInPageStatus } from "../Shared/Types/Types";

const logger = Logger.createLogger("Background::MouseInPageTracker");

type OnChangeListener = (mouseInPageStatus: MouseInPageStatus, tab: ChromeTabWithId) => void;

let m_mouseInPageStatus: MouseInPageStatus = "left";
let m_initializationPromise: Promise<void> | null = null;
let m_onChangeListeners: OnChangeListener[] = [];

export async function initialize() {
  const myLogger = logger.createNestedLogger("initialize");
  if (m_initializationPromise) {
    throw new Error(myLogger.getPrefixedMessage("MouseInPageTracker already initialized"));
  }

  m_initializationPromise = new Promise<void>(async (resolve, reject) => {
    try {
      const [activeTab] = (await chrome.tabs.query({
        active: true,
        currentWindow: true,
      })) as ChromeTabWithId[];
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
        m_onChangeListeners.forEach((listener) =>
          listener(m_mouseInPageStatus, tab as ChromeTabWithId)
        );
      });
      resolve();
    } catch (error) {
      reject(myLogger.getPrefixedMessage(`Failed to initialize MouseInPageTracker: ${error}`));
    }
  });
}

export async function getStatus() {
  await waitForInitialization("getStatus");
  return m_mouseInPageStatus;
}

export async function isInPage() {
  await waitForInitialization("isInPage");
  return m_mouseInPageStatus === "entered" || m_mouseInPageStatus === "focused";
}

export async function addOnChangeListener(listener: OnChangeListener) {
  throwIfNotInitialized("addOnChangeListener");
  m_onChangeListeners.push(listener);
}

export async function removeOnChangeListener(listener: OnChangeListener) {
  throwIfNotInitialized("removeOnChangeListener");
  m_onChangeListeners = m_onChangeListeners.filter((l) => l !== listener);
}

async function waitForInitialization(messagePrefix: string) {
  throwIfNotInitialized(messagePrefix);
  await m_initializationPromise;
}

function throwIfNotInitialized(messagePrefix: string) {
  if (!m_initializationPromise) {
    throw new Error(messagePrefix + "::MouseInPageTracker is not initialized");
  }
}
