export function forEachNestedFrame(callback: (frame: Window) => void) {
  function recurseFrames(context: Window) {
    for (var i = 0; i < context.frames.length; i++) {
      callback(context.frames[i]);
      recurseFrames(context.frames[i]);
    }
  }
  recurseFrames(window);
}

export function getNestedFrames() {
  var allFrames: Window[] = [];
  function recurseFrames(context: Window) {
    for (var i = 0; i < context.frames.length; i++) {
      allFrames.push(context.frames[i]);
      recurseFrames(context.frames[i]);
    }
  }
  recurseFrames(window);
  return allFrames;
}
