import DetachableDOM from "../detachableDOM";

let primaryTabGroupTrigger = false;

chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
  console.log("content_script.tsx::onMessage::msg:", msg);
  if (msg.type === "enableAutoCollapseTrigger") {
    primaryTabGroupTrigger = true;
  } else if (msg.type === "disableAutoCollapseTrigger") {
    primaryTabGroupTrigger = false;
  }

  sendResponse();
});


DetachableDOM.addEventListener(document, "mouseenter", event => {
  console.log("mouseenter event:", event);
  if(primaryTabGroupTrigger) {
    chrome.runtime.sendMessage({ type: "primaryTabGroupTrigger", data: { triggerType: "mouseenter" } });
    primaryTabGroupTrigger = false;
  }
}, true)
