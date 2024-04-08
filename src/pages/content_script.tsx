import DetachableDOM from "../detachableDOM";
import { PDFViewerOverlay } from "../DOM";
import Misc from "../misc";
import ContentHelper from "../contentHelper";

const isMainFrame = window === window.top;

// Ping-pong message to check if the content script is running
if(isMainFrame) {
  chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
    if (msg.type === "ping") {
      sendResponse();
    }
  });
}

// PDF Viewer Overlay
// @ts-ignore
const isPDFViewer = document.body.childNodes.values().find((node) => node.tagName === "EMBED" && node.type === "application/pdf");
if (isPDFViewer) {
  PDFViewerOverlay.attach();
}

// user page focus detection
let listenToPageFocusEvents = true;
let pageFocusTimeoutId: number | null = null;
let initialMousePosition: { x: number, y: number } | null = null;
const MINIMUM_MOUSE_MOVEMENT_PX = 2

window.addEventListener("message", event => {
  if(event.data.type === "startPageFocusTimeout") {
    // this message is sent only to the main frame by a nested frame when it wants to start the page focus timeout
    if(!isMainFrame) {
      console.warn("the startPageFocusTimeout message should only be sent to the main frame");
      return;
    }
    startPageFocusTimeout()
  } else if(event.data.type === "clearPageFocusTimeout") {
    // this message is sent by the main frame to all nested frames when it wants to clear the page focus timeout
    if(isMainFrame) {
      console.warn("the clearPageFocusTimeout message should not be sent to the main frame");
      return;
    }
    clearPageFocusTimeout()
  }
})

// the events that start the page focus timeout (all frames):
// 1. mouse down
// 2. click
// 3. keydown
// 4. mouse move (if the mouse moves more than 2px)
// 5. scroll

// the events that clear the page focus timeout (main frame only):
// 6. mouse leave
// 7. visibility change to hidden

// 1
DetachableDOM.addEventListener(window, "mousedown", () => {
  if(listenToPageFocusEvents) {
    startPageFocusTimeout()
  }
}, true)

// 2
DetachableDOM.addEventListener(window, "click", () => {
  if(listenToPageFocusEvents) {
    startPageFocusTimeout()
  }
}, true)

// 3
DetachableDOM.addEventListener(window, "keydown", () => {
  if(listenToPageFocusEvents) {
    startPageFocusTimeout()
  }
}, true)

// 4
DetachableDOM.addEventListener(window, "mousemove", async event => {
  // @ts-ignore
  const { screenX, screenY } = event;

  if(initialMousePosition === null) {
    initialMousePosition = { x: screenX, y: screenY }
  }

  const hasMovedMouseMinimum = Math.abs(screenX - initialMousePosition.x) > MINIMUM_MOUSE_MOVEMENT_PX || Math.abs(screenY - initialMousePosition.y) > MINIMUM_MOUSE_MOVEMENT_PX;
  if(hasMovedMouseMinimum && listenToPageFocusEvents) {
    startPageFocusTimeout()
  }
}, true)

// 5
DetachableDOM.addEventListener(window, "scroll", () => {
  if(listenToPageFocusEvents) {
    startPageFocusTimeout()
  }
}, true)

if(isMainFrame) {
  // 6
  DetachableDOM.addEventListener(document, "mouseleave", event => {
    if(event.target !== document) {
      return
    }

    clearPageFocusTimeout()
  }, true)

  // 7
  DetachableDOM.addEventListener(window, "visibilitychange", event => {
    if (document.visibilityState === "hidden") {
      clearPageFocusTimeout();
    }
  }, true)
}

function startPageFocusTimeout() {
  listenToPageFocusEvents = false;

  if(isPDFViewer && PDFViewerOverlay.attached()) {
    PDFViewerOverlay.remove();
  }

  if(!isMainFrame) {
    // let the main frame do the rest
    if(window.top) {
      window.top.postMessage({ type: "startPageFocusTimeout" }, "*");
    } else {
      // FIXME: in which cases is window.top null?
      console.warn("window.top is null, cannot send message to top frame")
    }

    return;
  }

  pageFocusTimeoutId = DetachableDOM.setTimeout(() => {
    chrome.runtime.sendMessage({ type: "pageFocused" });
    pageFocusTimeoutId = null;
  }, 4000);
}

function clearPageFocusTimeout() {
  if(isMainFrame) {
    // let all child frames know to stop
    Misc.callAsync(() => {
      ContentHelper.forEachNestedFrame(frame => {
        frame.postMessage({ type: "clearPageFocusTimeout" }, "*");
      })
    })
  }

  initialMousePosition = null;
  listenToPageFocusEvents = true

  if(pageFocusTimeoutId !== null) {
    DetachableDOM.clearTimeout(pageFocusTimeoutId)
    pageFocusTimeoutId = null;
  }

  if(isPDFViewer && !PDFViewerOverlay.attached()) {
    PDFViewerOverlay.attach()
  }
}