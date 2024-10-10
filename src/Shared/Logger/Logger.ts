export interface Logger {
  createNestedLogger: (nestedPrefix?: string, filter?: (message: string) => boolean) => Logger;
  getPrefixedMessage: (message: string) => string;
  setEnableLogging: (value: boolean) => void;
  log: (message: any, ...args: any[]) => void;
  warn: (message: any, ...args: any[]) => void;
  error: (message: any, ...args: any[]) => void;
  logPrefixed: (message: any, ...args: any[]) => void;
  warnPrefixed: (message: any, ...args: any[]) => void;
  errorPrefixed: (message: any, ...args: any[]) => void;
  throwPrefixed: (message?: string | undefined) => void;
}

export function createLogger(
  prefix?: string,
  options?: {
    enableLogging?: boolean;
    color?: string;
    divider?: string;
    filter?: (message: string) => boolean;
  },
  extraArgs?: any[]
) {
  let enableLogging: boolean = options?.enableLogging === undefined ? true : options.enableLogging;
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

  const nestedColors = [
    "#E57373",
    "#81C784",
    "#64B5F6",
    "#FFB74D",
    "#9575CD",
    "#A1887F",
    "#4DD0E1",
    "#BA68C8",
    "#F48FB1",
    "#26A69A",
    "#FFF176",
  ];
  let currentColorIndex = 0;
  function createNestedLogger(nestedPrefix?: string, filter?: (message: string) => boolean) {
    const nestedColor = nestedColors[currentColorIndex];
    currentColorIndex = (currentColorIndex + 1) % nestedColors.length;

    const formattedPrefixData = getFormattedTextAndCSSColor(nestedPrefix || "", nestedColor);
    const cssColors = options?.color
      ? [getCSSColorText(options.color), getCSSColorText("initial"), ...formattedPrefixData[1]]
      : formattedPrefixData[1];

    return createLogger(
      resultingPrefixString + formattedPrefixData[0],
      { filter, enableLogging },
      cssColors
    );
  }

  function getPrefixedMessage(message: string) {
    return resultingPrefixString + message;
  }

  function log(key: string, message: any, ...args: any[]) {
    if (!enableLogging || (options?.filter && !options.filter(message))) {
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

  return {
    createNestedLogger,
    getPrefixedMessage,
    setEnableLogging: (value: boolean) => {
      enableLogging = value;
    },
    log: (message: any, ...args: any[]) => {
      log("log", message, ...args);
    },
    warn: (message: any, ...args: any[]) => {
      log("warn", message, ...args);
    },
    error: (message: any, ...args: any[]) => {
      log("error", message, ...args);
    },
    logPrefixed: (message: any, ...args: any[]) => {
      log("log", getPrefixedMessage(message), ...args);
    },
    warnPrefixed: (message: any, ...args: any[]) => {
      log("warn", getPrefixedMessage(message), ...args);
    },
    errorPrefixed: (message: any, ...args: any[]) => {
      log("error", getPrefixedMessage(message), ...args);
    },
    throwPrefixed: (message?: string | undefined) => {
      throw new Error(message ? getPrefixedMessage(message) : undefined);
    },
  };
}

export const attentionLogger = createLogger("ATTENTION", { color: "#ff0f0f" });

function wrapTextWithColor(text: string) {
  return `%c${text}%c`;
}

function getCSSColorText(color: string) {
  return `color: ${color};`;
}

function getFormattedTextAndCSSColor(text: string, color: string) {
  return [
    wrapTextWithColor(text),
    [getCSSColorText(color), getCSSColorText("initial")] as [string, string],
  ] as const;
}
