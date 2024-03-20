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

// Primary Tab Activation
let listenToPrimaryTabActivationTrigger = true;
let primaryTabActivationTimeoutId: number | null = null;
let initialMousePosition: { x: number, y: number } | null = null;
const MINIMUM_MOUSE_MOVEMENT_PX = 2

window.addEventListener("message", event => {
  if(event.data.type === "startPrimaryTabActivation") {
    // this message is sent only to the main frame by a nested frame when it wants to start the activation
    if(!isMainFrame) {
      console.warn("the startPrimaryTabActivation message should only be sent to the main frame");
      return;
    }
    startPrimaryTabActivation()
  } else if(event.data.type === "stopPrimaryTabActivation") {
    // this message is sent by the main frame to all nested frames when it wants to stop the activation
    if(isMainFrame) {
      console.warn("the stopPrimaryTabActivation message should not be sent to the main frame");
      return;
    }
    stopPrimaryTabActivation()
  }
})

// the events that start the primary tab activation:
// 1. mouse down
// 2. click
// 3. keydown
// 4. mouse move (if the mouse moves more than 2px)

// the events that stop the primary tab activation (main frame only):
// 5. mouse leave
// 6. visibility change to hidden

// 1
DetachableDOM.addEventListener(window, "mousedown", () => {
  if(listenToPrimaryTabActivationTrigger) {
    startPrimaryTabActivation()
  }
}, true)

// 2
DetachableDOM.addEventListener(window, "click", () => {
  if(listenToPrimaryTabActivationTrigger) {
    startPrimaryTabActivation()
  }
}, true)

// 3
DetachableDOM.addEventListener(window, "keydown", () => {
  if(listenToPrimaryTabActivationTrigger) {
    startPrimaryTabActivation()
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
  if(hasMovedMouseMinimum && listenToPrimaryTabActivationTrigger) {
    startPrimaryTabActivation()
  }
}, true)

if(isMainFrame) {
  // 5
  DetachableDOM.addEventListener(document, "mouseleave", event => {
    if(event.target !== document) {
      return
    }

    stopPrimaryTabActivation()
  }, true)

  // 6
  DetachableDOM.addEventListener(window, "visibilitychange", event => {
    if (document.visibilityState === "hidden") {
      stopPrimaryTabActivation();
    }
  }, true)
}

function startPrimaryTabActivation() {
  listenToPrimaryTabActivationTrigger = false;

  if(isPDFViewer && PDFViewerOverlay.attached()) {
    PDFViewerOverlay.remove();
  }

  if(!isMainFrame) {
    // let the main frame do the rest
    if(window.top) {
      window.top.postMessage({ type: "startPrimaryTabActivation" }, "*");
    } else {
      // FIXME: in which cases is window.top null?
      console.warn("window.top is null, cannot send message to top frame")
    }

    return;
  }

  primaryTabActivationTimeoutId = DetachableDOM.setTimeout(() => {
    chrome.runtime.sendMessage({ type: "primaryTabActivationTrigger" });
    primaryTabActivationTimeoutId = null;
  }, 4000);
}

function stopPrimaryTabActivation() {

  if(isMainFrame) {
    // let all child frames know to stop
    Misc.callAsync(() => {
      ContentHelper.forEachNestedFrame(frame => {
        frame.postMessage({ type: "stopPrimaryTabActivation" }, "*");
      })
    })
  }

  initialMousePosition = null;
  listenToPrimaryTabActivationTrigger = true

  if(primaryTabActivationTimeoutId !== null) {
    DetachableDOM.clearTimeout(primaryTabActivationTimeoutId)
    primaryTabActivationTimeoutId = null;
  }

  if(isPDFViewer && !PDFViewerOverlay.attached()) {
    PDFViewerOverlay.attach()
  }
}