export function getLogger(prefix?: string, prefixOptions?: { color?: string; divider?: string }) {
  let resultingPrefixString = "";
  const otherLogArguments: any[] = [];
  if (prefix) {
    if (prefixOptions?.color) {
      resultingPrefixString += `%c${prefix}%c`;
      otherLogArguments.push(`color: ${prefixOptions.color};`, "color: initial;");
    } else {
      resultingPrefixString += prefix;
    }
    const prefixDivider = prefixOptions?.divider || "::";
    resultingPrefixString += prefixDivider;
  }

  return {
    log: (message: any, ...args: any[]) => {
      console.log(resultingPrefixString + message, ...otherLogArguments, ...args);
    },
    warn: (message: any, ...args: any[]) => {
      console.warn(resultingPrefixString + message, ...otherLogArguments, ...args);
    },
    error: (message: any, ...args: any[]) => {
      console.error(resultingPrefixString + message, ...otherLogArguments, ...args);
    },
  };
}

export const attentionLogger = getLogger("ATTENTION", { color: "#ff0f0f" });
