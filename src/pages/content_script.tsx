import DetachableDOM from "../detachableDOM";

let primaryTabGroupTrigger = false;
let primaryTabGroupTriggerTimeoutId: number | null = null

function onPrimaryTabGroupTriggerTimeout() {
  chrome.runtime.sendMessage({ type: "primaryTabGroupTrigger", data: { triggerType: "mouseenter" } });
}

chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
  console.log("content_script.tsx::onMessage::msg:", msg);
  if (msg.type === "enablePrimaryTabTrigger") {
    primaryTabGroupTrigger = true;
  } else if (msg.type === "disablePrimaryTabTrigger") {
    primaryTabGroupTrigger = false;
  }

  sendResponse();
});


DetachableDOM.addEventListener(document, "mouseenter", event => {
  console.log("mouseenter event:", event);
  if(primaryTabGroupTrigger) {
    primaryTabGroupTriggerTimeoutId = DetachableDOM.setTimeout(onPrimaryTabGroupTriggerTimeout, 500);
    primaryTabGroupTrigger = false;
  }
}, true)

DetachableDOM.addEventListener(document, "mouseleave", event => {
  console.log("mouseleave event:", event);
  if(primaryTabGroupTriggerTimeoutId !== null) {
    DetachableDOM.clearTimeout(primaryTabGroupTriggerTimeoutId)
    primaryTabGroupTrigger = true
  }
}, true)
