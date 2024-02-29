import DetachableDOM from "../detachableDOM";

let primaryTabGroupTrigger = false;

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
    chrome.runtime.sendMessage({ type: "primaryTabGroupTrigger", data: { triggerType: "mouseenter" } });
    primaryTabGroupTrigger = false;
  }
}, true)
