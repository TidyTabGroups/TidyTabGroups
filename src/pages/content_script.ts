import DetachableDOM from "../detachableDOM";
import { PDFViewerOverlay } from "../DOM";
import Misc from "../misc";
import ContentHelper from "../contentHelper";
import { MouseInPageStatus } from "../types/types";

const isMainFrame = window === window.top;

// Ping-pong message to check if the content script is running
if (isMainFrame) {
  chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
    if (msg.type === "ping") {
      sendResponse();
    }
  });
}

// PDF Viewer Overlay
const isPDFViewer = document.contentType === "application/pdf";
if (isPDFViewer) {
  DetachableDOM.addEventListener(
    document,
    "DOMContentLoaded",
    () => {
      PDFViewerOverlay.attach();
    },
    true
  );
}

// Mouse In Page Tracker:
// the events that start the page focus timeout (all frames):
// - mouse down
// - click
// - keydown
// - mouse move (if the mouse moves more than 2px)
// the events that clear the page focus timeout (main frame only):
// - mouse leave
// - visibility change to hidden

let listenToPageFocusEvents = true;
let pageFocusTimeoutId: number | null = null;
let initialMousePosition: { x: number; y: number } | null = null;
const MINIMUM_MOUSE_MOVEMENT_PX = 2;
let mouseInPageStatus: MouseInPageStatus = "left";

if (isMainFrame) {
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === "getMouseInPageStatus") {
      sendResponse(mouseInPageStatus);
    }
  });

  DetachableDOM.addEventListener(
    document,
    "mouseenter",
    (event) => {
      if (event.target !== document) {
        return;
      }
      setMouseInPageStatus("entered");
    },
    true
  );

  DetachableDOM.addEventListener(
    document,
    "mouseleave",
    (event) => {
      if (event.target !== document) {
        return;
      }
      setMouseInPageStatus("left");
      clearPageFocusTimeout();
    },
    true
  );

  DetachableDOM.addEventListener(
    window,
    "visibilitychange",
    (event) => {
      if (document.visibilityState === "hidden") {
        clearPageFocusTimeout();
      }
    },
    true
  );
}

window.addEventListener("message", (event) => {
  if (event.data.type === "startPageFocusTimeout") {
    // this message is sent only to the main frame by a nested frame when it wants to start the page focus timeout
    if (!isMainFrame) {
      console.warn("the startPageFocusTimeout message should only be sent to the main frame");
      return;
    }
    startPageFocusTimeout();
  } else if (event.data.type === "clearPageFocusTimeout") {
    // this message is sent by the main frame to all nested frames when it wants to clear the page focus timeout
    if (isMainFrame) {
      console.warn("the clearPageFocusTimeout message should not be sent to the main frame");
      return;
    }
    clearPageFocusTimeout();
  } else if (event.data.type === "mouseEnteredRelatedEvent") {
    if (!isMainFrame) {
      console.warn("the mouseEnteredRelatedEvent message should only be sent to the main frame");
      return;
    }

    if (mouseInPageStatus === "left") {
      setMouseInPageStatus("entered");
    }
  }
});

DetachableDOM.addEventListener(
  window,
  "mousedown",
  () => {
    if (listenToPageFocusEvents) {
      startPageFocusTimeout();
    }
  },
  true
);

DetachableDOM.addEventListener(
  window,
  "click",
  () => {
    if (listenToPageFocusEvents) {
      startPageFocusTimeout();
    }
  },
  true
);

DetachableDOM.addEventListener(
  window,
  "keydown",
  () => {
    if (listenToPageFocusEvents) {
      startPageFocusTimeout();
    }
  },
  true
);

DetachableDOM.addEventListener(
  window,
  "mousemove",
  async (event) => {
    // @ts-ignore
    const { screenX, screenY } = event;

    if (initialMousePosition === null) {
      initialMousePosition = { x: screenX, y: screenY };
    }

    const hasMovedMouseMinimum =
      Math.abs(screenX - initialMousePosition.x) > MINIMUM_MOUSE_MOVEMENT_PX ||
      Math.abs(screenY - initialMousePosition.y) > MINIMUM_MOUSE_MOVEMENT_PX;
    if (hasMovedMouseMinimum && listenToPageFocusEvents) {
      startPageFocusTimeout();
    }
  },
  true
);

function startPageFocusTimeout() {
  listenToPageFocusEvents = false;

  if (isPDFViewer && PDFViewerOverlay.attached()) {
    PDFViewerOverlay.remove();
  }

  if (!isMainFrame) {
    // let the main frame do the rest
    window.top?.postMessage({ type: "startPageFocusTimeout" }, "*");
    return;
  }

  pageFocusTimeoutId = DetachableDOM.setTimeout(() => {
    setMouseInPageStatus("focused");
    pageFocusTimeoutId = null;
  }, 2500);
}

function clearPageFocusTimeout() {
  if (isMainFrame) {
    // let all child frames know to stop
    Misc.callAsync(() => {
      ContentHelper.forEachNestedFrame((frame) => {
        frame.postMessage({ type: "clearPageFocusTimeout" }, "*");
      });
    });
  }

  initialMousePosition = null;
  listenToPageFocusEvents = true;

  if (pageFocusTimeoutId !== null) {
    DetachableDOM.clearTimeout(pageFocusTimeoutId);
    pageFocusTimeoutId = null;
  }

  if (isPDFViewer && !PDFViewerOverlay.attached()) {
    PDFViewerOverlay.attach();
  }
}

function setMouseInPageStatus(status: MouseInPageStatus) {
  mouseInPageStatus = status;
  chrome.runtime.sendMessage({ type: "mouseInPageStatusChanged", data: mouseInPageStatus });
}
