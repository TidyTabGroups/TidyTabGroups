export function getLogger(prefix?: string, options?: { color?: string; divider?: string; filter?: (message: string) => boolean }, extraArgs?: any[]) {
  let resultingPrefixString = "";
  const otherLogArguments: any[] = extraArgs || [];
  if (prefix) {
    if (options?.color) {
      const [formattedPrefix, cssColors] = getFormattedTextAndCSSColor(prefix, options.color);
      resultingPrefixString += formattedPrefix;
      otherLogArguments.unshift(...cssColors);
    } else {
      resultingPrefixString += prefix;
    }
    const prefixDivider = options?.divider || "::";
    resultingPrefixString += prefixDivider;
  }

  function log(key: string, message: any, ...args: any[]) {
    if (options?.filter && !options.filter(message)) {
      return;
    }

    const finalArgs = [resultingPrefixString + message, ...otherLogArguments, ...args];
    switch (key) {
      case "log":
        console.log(...finalArgs);
        break;
      case "warn":
        console.warn(...finalArgs);
        break;
      case "error":
        console.error(...finalArgs);
        break;
    }
  }

  const nestedColors = ["#E57373", "#81C784", "#64B5F6", "#FFB74D", "#9575CD", "#A1887F", "#4DD0E1", "#BA68C8", "#F48FB1", "#26A69A", "#FFF176"];
  let currentColorIndex = 0;
  function getNestedLogger(scopedPrefix?: string, filter?: (message: string) => boolean) {
    const nestedColor = nestedColors[currentColorIndex];
    currentColorIndex = (currentColorIndex + 1) % nestedColors.length;

    const formattedPrefixData = getFormattedTextAndCSSColor(scopedPrefix || "", nestedColor);
    const cssColors = options?.color
      ? [getCSSColorText(options.color), getCSSColorText("initial"), ...formattedPrefixData[1]]
      : formattedPrefixData[1];

    return getLogger(resultingPrefixString + formattedPrefixData[0], { filter }, cssColors);
  }

  function getPrefixedMessage(message: string) {
    return resultingPrefixString + message;
  }

  return {
    getNestedLogger,
    getPrefixedMessage,
    log: (message: any, ...args: any[]) => {
      log("log", message, ...args);
    },
    warn: (message: any, ...args: any[]) => {
      log("warn", message, ...args);
    },
    error: (message: any, ...args: any[]) => {
      log("error", message, ...args);
    },
  };
}

export const attentionLogger = getLogger("ATTENTION", { color: "#ff0f0f" });

function wrapTextWithColor(text: string) {
  return `%c${text}%c`;
}

function getCSSColorText(color: string) {
  return `color: ${color};`;
}

function getFormattedTextAndCSSColor(text: string, color: string) {
  return [wrapTextWithColor(text), [getCSSColorText(color), getCSSColorText("initial")] as [string, string]] as const;
}
