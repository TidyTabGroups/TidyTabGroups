import DetachableDOM from "../detachableDOM";
import { PDFViewerOverlay } from "../DOM";
import Misc from "../misc";
import ContentHelper from "../contentHelper";
import { MouseInPageStatus } from "../types/types";
import Logger from "../logger";

// Mouse In Page Tracker
// regarding non-moving cursors that are already in a document:
// 1. An already loaded document becomes visible: mouseenter/mousemove events DO get dispatched. If the cursor is
//  in a subframe, the main frame will not receive the events.
// 2. A document gets loaded: mouseenter/mousemove events DO NOT get dispatched when a document loads. Once the mouse is moved, both the main frame
//   and the subframe (if exists) will receive both events. Regarding the mousemove events, the main frame only receives
//   it onces; subsequent mousemove events in a subframe are only received by the subframe.
// Note: this was observed on stable Chrome 126.0.6478.127 on July 4th 2024

// FIXME: There might be cases where the main frame is not accessible, but the subframes are. In this case, the mouse tracker logic will not work.

const logger = Logger.getLogger("content_script");
const isMainFrame = window === window.top;

// Ping-pong message to check if the content script is running
if (isMainFrame) {
  chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
    if (msg.type === "ping") {
      sendResponse();
    }
  });
}

// For PDFs, an overlay element is attached to the document to detect mousemove events. It is then detached after the events are handled.
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

let listenToPageFocusEvents = true;
let pageFocusTimeoutId: number | null = null;
let initialMousePosition: { x: number; y: number } | null = null;
const MINIMUM_MOUSE_MOVEMENT_PX = 2;
let mouseInPageStatus: MouseInPageStatus = "left";
let notifyMainFrameAboutMouseEnter = true;

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

      // FIXME: in PDFs, this handler runs twice when run_at is set to document_start because of PDFViewerOverlay
      if (mouseInPageStatus === "entered") {
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
      enableNotifyMainFrameAboutMouseEnterForSubframes();
    },
    true
  );

  DetachableDOM.addEventListener(
    window,
    "visibilitychange",
    (event) => {
      if (document.visibilityState === "hidden") {
        clearPageFocusTimeout();
        enableNotifyMainFrameAboutMouseEnterForSubframes();
      }
    },
    true
  );

  function enableNotifyMainFrameAboutMouseEnterForSubframes() {
    ContentHelper.forEachNestedFrame((frame) => {
      frame.postMessage({ type: "enableNotifyMainFrameAboutMouseEnter" }, "*");
    });
  }
}

DetachableDOM.addEventListener(window, "message", (event) => {
  // @ts-ignore
  const { type } = event.data;
  if (!type) {
    return;
  }

  const myLogger = logger.getNestedLogger("message");
  if (type === "startPageFocusTimeout") {
    // this message is sent only to the main frame by a nested frame when it wants to start the page focus timeout
    if (!isMainFrame) {
      myLogger.warn("the startPageFocusTimeout message should only be sent to the main frame");
      return;
    }

    if (listenToPageFocusEvents) {
      startPageFocusTimeout();
    }
  } else if (type === "clearPageFocusTimeout") {
    // this message is sent by the main frame to all nested frames when it wants to clear the page focus timeout
    if (isMainFrame) {
      myLogger.warn("the clearPageFocusTimeout message should not be sent to the main frame");
      return;
    }

    if (!listenToPageFocusEvents) {
      clearPageFocusTimeout();
    }
  } else if (type === "mouseEnteredRelatedEvent") {
    if (!isMainFrame) {
      myLogger.warn("the mouseEnteredRelatedEvent message should only be sent to the main frame");
      return;
    }

    if (mouseInPageStatus === "left") {
      setMouseInPageStatus("entered");
    }
  } else if (type === "enableNotifyMainFrameAboutMouseEnter") {
    if (isMainFrame) {
      myLogger.warn("enableNotifyMainFrameAboutMouseEnter should only be sent to subframes");
      return;
    }

    notifyMainFrameAboutMouseEnter = true;
  }
});

DetachableDOM.addEventListener(
  window,
  "mousedown",
  () => {
    onMouseEnterRelatedEvent();
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
    onMouseEnterRelatedEvent();
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
    onMouseEnterRelatedEvent();
    if (listenToPageFocusEvents) {
      startPageFocusTimeout();
    }
  },
  true
);

DetachableDOM.addEventListener(
  window,
  "mousemove",
  (event) => {
    onMouseEnterRelatedEvent();
    // @ts-ignore
    const { screenX, screenY } = event;

    if (initialMousePosition === null) {
      initialMousePosition = { x: screenX, y: screenY };
    }

    if (listenToPageFocusEvents) {
      const hasMovedMouseMinimum =
        Math.abs(screenX - initialMousePosition.x) > MINIMUM_MOUSE_MOVEMENT_PX ||
        Math.abs(screenY - initialMousePosition.y) > MINIMUM_MOUSE_MOVEMENT_PX;
      if (hasMovedMouseMinimum) {
        startPageFocusTimeout();
      }
    }
  },
  true
);

function startPageFocusTimeout() {
  const myLogger = Logger.getLogger("startPageFocusTimeout");
  if (!listenToPageFocusEvents) {
    myLogger.warn("should not be called when listenToPageFocusEvents is false - isMainFrame: ", isMainFrame);
    return;
  }

  listenToPageFocusEvents = false;

  if (isPDFViewer) {
    PDFViewerOverlay.remove();
  }

  if (!isMainFrame) {
    // let the main frame do the rest
    window.top?.postMessage({ type: "startPageFocusTimeout" }, "*");
    return;
  }

  if (pageFocusTimeoutId !== null) {
    myLogger.warn("pageFocusTimeoutId should be null");
    return;
  }

  pageFocusTimeoutId = DetachableDOM.setTimeout(() => {
    setMouseInPageStatus("focused");
    pageFocusTimeoutId = null;
  }, 2500);
}

function clearPageFocusTimeout() {
  const myLogger = logger.getNestedLogger("clearPageFocusTimeout");
  if (listenToPageFocusEvents) {
    myLogger.warn("should not be called when listenToPageFocusEvents is true - isMainFrame: ", isMainFrame);
    return;
  }

  initialMousePosition = null;
  listenToPageFocusEvents = true;

  if (isPDFViewer) {
    PDFViewerOverlay.attach();
  }

  if (isMainFrame) {
    if (pageFocusTimeoutId !== null) {
      DetachableDOM.clearTimeout(pageFocusTimeoutId);
      pageFocusTimeoutId = null;
    }

    // let all child frames know to clear
    Misc.callAsync(() => {
      ContentHelper.forEachNestedFrame((frame) => {
        frame.postMessage({ type: "clearPageFocusTimeout" }, "*");
      });
    });
  }
}

function setMouseInPageStatus(status: MouseInPageStatus) {
  const myLogger = logger.getNestedLogger("setMouseInPageStatus");
  if (!isMainFrame) {
    myLogger.warn("should only be called in the main frame");
    return;
  }

  if (mouseInPageStatus === status) {
    myLogger.warn("cannot set the same mouseInPageStatus: ", status);
    return;
  }

  mouseInPageStatus = status;
  chrome.runtime.sendMessage({ type: "mouseInPageStatusChanged", data: mouseInPageStatus });
}

function onMouseEnterRelatedEvent() {
  if (isMainFrame && mouseInPageStatus === "left") {
    setMouseInPageStatus("entered");
  } else if (!isMainFrame && notifyMainFrameAboutMouseEnter) {
    notifyMainFrameAboutMouseEnter = false;
    window.top?.postMessage({ type: "mouseEnteredRelatedEvent" }, "*");
  }
}
