type DetachJobType =
  | "removeEventListener"
  | "removeNode"
  | "clearInterval"
  | "clearTimeout"
  | "disconnectMutationObserver";

interface DetachJob {
  jobType: DetachJobType;
  data: any;
}

// a list of detach jobs ie. unbinding event listeners, clear timers, remove DOM nodes etc.
let detachJobs: DetachJob[] = [];

export const addEventListener = (
  target: EventTarget,
  type: string,
  callback: EventListenerOrEventListenerObject | null,
  options?: AddEventListenerOptions | boolean
) => {
  detachJobs.push({
    jobType: "removeEventListener",
    data: {
      target,
      type,
      callback,
      options,
    },
  });

  return target.addEventListener(type, callback, options);
};

export const removeEventListener = (
  target: EventTarget,
  type: string,
  callback: EventListenerOrEventListenerObject | null,
  options?: EventListenerOptions | boolean
) => {
  let returnValue = undefined;
  // remove the job from jobs array and remove event listener
  detachJobs = detachJobs.filter((job) => {
    if (
      job.jobType === "removeEventListener" &&
      job.data.target === target &&
      job.data.type === type &&
      job.data.callback === callback &&
      job.data.options === options
    ) {
      returnValue = target.removeEventListener(type, callback, options);
      return false;
    }
    return true;
  });

  return returnValue;
};

/* ADD NODE TO DOM */
export const appendChild = (target: Node, node: Node) => {
  detachJobs.push({
    jobType: "removeNode",
    data: {
      node,
    },
  });

  return target.appendChild(node);
};

export const insertBefore = (parentNode: Node, newNode: Node, referenceNode: Node) => {
  detachJobs.push({
    jobType: "removeNode",
    data: {
      node: newNode,
    },
  });

  return parentNode.insertBefore(newNode, referenceNode);
};

export const prepend = (target: ParentNode, newNode: Node) => {
  detachJobs.push({
    jobType: "removeNode",
    data: {
      node: newNode,
    },
  });

  return target.prepend(newNode);
};

export const remove = (nodeToRemove: ChildNode) => {
  let returnValue = undefined;
  // remove the job from jobs array and remove the node from DOM
  detachJobs = detachJobs.filter((job) => {
    if (job.jobType === "removeNode" && job.data.node === nodeToRemove) {
      returnValue = nodeToRemove.remove();
      return false;
    }
    return true;
  });

  return returnValue;
};

/* SETTING WINDOW TIMERS */
export const setInterval = (handler: TimerHandler, timeout?: number, ...args: any[]) => {
  const id = window.setInterval(handler, timeout, ...args);
  detachJobs.push({
    jobType: "clearInterval",
    data: { id },
  });
  return id;
};

export const clearInterval = (id: number) => {
  let returnValue = undefined;
  // remove the job from jobs array and clear the interval
  detachJobs = detachJobs.filter((job) => {
    if (job.jobType === "clearInterval" && job.data.id === id) {
      returnValue = window.clearInterval(id);
      return false;
    }
    return true;
  });

  return returnValue;
};

export const setTimeout = (handler: TimerHandler, timeout?: number, ...args: any[]) => {
  const id = window.setTimeout(handler, timeout, ...args);
  detachJobs.push({
    jobType: "clearTimeout",
    data: { id },
  });
  return id;
};

export const clearTimeout = (id: number) => {
  let returnValue = undefined;
  // remove the job from jobs array and clear the timeout
  detachJobs = detachJobs.filter((job) => {
    if (job.jobType === "clearTimeout" && job.data.id === id) {
      returnValue = window.clearTimeout(id);
      return false;
    }
    return true;
  });

  return returnValue;
};

/* ADDING MUTATION OBSERVER */
export const addMutationObserver = (callback: MutationCallback) => {
  const mutationObserver = new MutationObserver(callback);
  detachJobs.push({
    jobType: "disconnectMutationObserver",
    data: {
      mutationObserver,
    },
  });
  return mutationObserver;
};

export const disconnectMutationObserver = (mutationObserver: MutationObserver) => {
  let returnValue = undefined;
  // remove the job from jobs array and disconnect the mutationObserver
  detachJobs = detachJobs.filter((job) => {
    if (
      job.jobType === "disconnectMutationObserver" &&
      job.data.mutationObserver === mutationObserver
    ) {
      returnValue = mutationObserver.disconnect();
      return false;
    }
    return true;
  });

  return returnValue;
};

/* function to detach all */
const detach = () => {
  // perform detach jobs ie. tear down content script
  detachJobs.forEach((job) => {
    const { jobType, data } = job;
    const { target, type, callback, options, node, id, mutationObserver } = data;
    switch (jobType) {
      case "removeEventListener":
        target.removeEventListener(type, callback, options);
        break;
      case "removeNode":
        node.remove();
        break;
      case "clearInterval":
        clearInterval(id);
        break;
      case "clearTimeout":
        clearTimeout(id);
        break;
      case "disconnectMutationObserver":
        mutationObserver.disconnect();
        break;
    }
  });
};

const detachEvent = "DETACHABLE__DETACH" + chrome.runtime.id;
// detach previous content script by dispatching out this custom event
document.dispatchEvent(new CustomEvent(detachEvent));
document.addEventListener(detachEvent, detach, { once: true });
