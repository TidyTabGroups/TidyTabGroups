import DetachableDOM from "../detachableDOM";

let primaryTabTrigger = false;
let primaryTabTriggerTimeoutId: number | null = null

function onPrimaryTabTriggerTimeout() {
  chrome.runtime.sendMessage({ type: "primaryTabTrigger", data: { triggerType: "mouseenter" } });
}

chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
  console.log("content_script.tsx::onMessage::msg:", msg);
  if (msg.type === "enablePrimaryTabTrigger") {
    primaryTabTrigger = true;
  } else if (msg.type === "disablePrimaryTabTrigger") {
    primaryTabTrigger = false;
  }

  sendResponse();
});


DetachableDOM.addEventListener(document, "mouseenter", event => {
  console.log("mouseenter event:", event);
  if(primaryTabTrigger) {
    primaryTabTriggerTimeoutId = DetachableDOM.setTimeout(onPrimaryTabTriggerTimeout, 500);
    primaryTabTrigger = false;
  }
}, true)

DetachableDOM.addEventListener(document, "mouseleave", event => {
  console.log("mouseleave event:", event);
  if(primaryTabTriggerTimeoutId !== null) {
    DetachableDOM.clearTimeout(primaryTabTriggerTimeoutId)
    primaryTabTrigger = true
  }
}, true)
