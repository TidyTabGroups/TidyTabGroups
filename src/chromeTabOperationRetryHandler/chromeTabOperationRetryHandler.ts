/* 
  Handles Chrome tab edit operations while accounting for potential user 
  interactions (like dragging) by providing retry mechanisms and allowing 
  replacing of operations between retries.
*/

import ChromeWindowHelper from "../chromeWindowHelper";
import Logger from "../logger";
import Misc from "../misc";

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

    const { result, encounteredUserInteractionError } = await ChromeWindowHelper.withUserInteractionErrorHandler(this.operation);
    if (!encounteredUserInteractionError) {
      return result;
    }

    logger.log(`Handled user interaction error for operation: `, this.operation.toString());
    await Misc.waitMs(100);

    let shouldRetry = this.shouldRetryOperationCallback ? await this.shouldRetryOperationCallback() : true;
    if (shouldRetry) {
      return await this.tryOperation();
    } else {
      return undefined as ShouldRetryOperation extends true ? T | undefined : T;
    }
  }
}
