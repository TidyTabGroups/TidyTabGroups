import DetachableDOM from "../detachableDOM";
import { PDFViewerOverlay } from "../DOM";

chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
  if (msg.type === "ping") {
    sendResponse();
  }
});

// @ts-ignore
const isPDFViewer = document.body.childNodes.values().find((node) => node.tagName === "EMBED" && node.type === "application/pdf");
if (isPDFViewer) {
  PDFViewerOverlay.attach();
}

let listenToPrimaryTabActivationTrigger = true;
let primaryTabActivationTimeoutId: number | null = null;
let initialMousePosition: { x: number, y: number } | null = null;
const MINIMUM_MOUSE_MOVEMENT_PX = 2

// the events that start the primary tab activation:
// 1. mouse down
// 2. click
// 3. keydown
// 4. mouse move (if the mouse moves more than 2px)

// the events that stop the primary tab activation:
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

function startPrimaryTabActivation() {
  listenToPrimaryTabActivationTrigger = false;

  if(isPDFViewer && PDFViewerOverlay.attached()) {
    PDFViewerOverlay.remove();
  }

  primaryTabActivationTimeoutId = DetachableDOM.setTimeout(() => {
    chrome.runtime.sendMessage({ type: "primaryTabActivationTrigger" });
    primaryTabActivationTimeoutId = null;
  }, 1500);
}

function stopPrimaryTabActivation() {
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