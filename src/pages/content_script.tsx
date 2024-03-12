import DetachableDOM from "../detachableDOM";

let primaryTabTriggerEnabled = true;
let primaryTabTriggerTimeoutId: number | null = null

function onPrimaryTabTriggerTimeout() {
  chrome.runtime.sendMessage({ type: "primaryTabTrigger", data: { triggerType: "mouseenter" } });
  primaryTabTriggerTimeoutId = null;
}

chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
  console.log("content_script.tsx::onMessage::msg:", msg);
  if (msg.type === "enablePrimaryTabTrigger") {
    primaryTabTriggerEnabled = true;
  } else if (msg.type === "disablePrimaryTabTrigger") {
    primaryTabTriggerEnabled = false;
  }

  sendResponse();
});


DetachableDOM.addEventListener(document, "mouseenter", event => {
  if(event.target !== document) {
    return
  }

  if(primaryTabTriggerEnabled) {
    console.log("ttg::mouseenter", event);
    primaryTabTriggerTimeoutId = DetachableDOM.setTimeout(onPrimaryTabTriggerTimeout, 500);
    primaryTabTriggerEnabled = false;
  }
}, true)

DetachableDOM.addEventListener(document, "mouseleave", event => {
  if(event.target !== document) {
    return
  }

  if(primaryTabTriggerTimeoutId !== null) {
    console.log("ttg:mouseleave:", event);
    DetachableDOM.clearTimeout(primaryTabTriggerTimeoutId)
    primaryTabTriggerTimeoutId = null;
    primaryTabTriggerEnabled = true
  }
}, true)
