/* 
  Handles Chrome tab edit operations while accounting for potential user 
  interactions (like dragging) by providing retry mechanisms and allowing 
  replacing of operations between retries.
*/

import Logger from "../logger";

const logger = Logger.createLogger("ChromeTabOperationRetryHandler");

// TODO: replace all uses of callAfterUserIsDoneTabDragging with this
type ShouldRetryOperationCallback<ShouldRetryOperation extends boolean> = ShouldRetryOperation extends true ? () => Promise<boolean> : undefined;
export default class ChromeTabOperationRetryHandler<T, ShouldRetryOperation extends boolean = false> {
  private operation: Promise<T> | null = null;
  private shouldRetryOperationCallback?: ShouldRetryOperationCallback<ShouldRetryOperation>;

  constructor(shouldRetryOperationCallback?: ShouldRetryOperationCallback<ShouldRetryOperation>) {
    this.shouldRetryOperationCallback = shouldRetryOperationCallback;
  }

  replaceOperation(operation: Promise<T>) {
    this.operation = operation;
  }

  setShouldRetryOperationCallback(shouldRetryOperationCallback: ShouldRetryOperationCallback<ShouldRetryOperation>) {
    this.shouldRetryOperationCallback = shouldRetryOperationCallback;
  }

  async try(operation: Promise<T>) {
    this.operation = operation;
    return this.tryOperation();
  }

  private async tryOperation(): Promise<ShouldRetryOperation extends true ? T | undefined : T> {
    if (this.operation === null) {
      throw new Error(logger.getPrefixedMessage("operation is null"));
    }

    try {
      return await this.operation;
    } catch (error) {
      // @ts-ignore
      if (error?.message !== "Tabs cannot be edited right now (user may be dragging a tab).") {
        throw error;
      }

      logger.log(`Handled user interaction: `, this.operation.toString());
      return new Promise((resolve, reject) =>
        setTimeout(async () => {
          try {
            let shouldRetry = this.shouldRetryOperationCallback ? await this.shouldRetryOperationCallback() : true;
            if (shouldRetry) {
              resolve(await this.tryOperation());
            } else {
              resolve(undefined as ShouldRetryOperation extends true ? T | undefined : T);
            }
          } catch (error) {
            reject(error);
          }
        }, 100)
      );
    }
  }
}
