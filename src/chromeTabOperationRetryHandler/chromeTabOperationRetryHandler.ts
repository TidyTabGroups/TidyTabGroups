/* 
  Handles Chrome tab edit operations while accounting for potential user 
  interactions (like dragging) by providing retry mechanisms and allowing 
  replacing of operations between retries.
*/

// TODO: replace all uses of callAfterUserIsDoneTabDragging with this
type ShouldRetryOperationCallback<ShouldRetryOperation extends boolean> = ShouldRetryOperation extends true ? () => Promise<boolean> : undefined;
export default class ChromeTabOperationRetryHandler<T, ShouldRetryOperation extends boolean = false> {
  private operation?: Promise<T>;
  private shouldRetryOperationCallback?: ShouldRetryOperationCallback<ShouldRetryOperation>;

  constructor(operation?: Promise<T>, shouldRetryOperationCallback?: ShouldRetryOperationCallback<ShouldRetryOperation>) {
    this.operation = operation;
    this.shouldRetryOperationCallback = shouldRetryOperationCallback;
  }

  setOperation(operation: Promise<T>) {
    this.operation = operation;
  }

  setShouldRetryOperationCallback(shouldRetryOperationCallback: ShouldRetryOperationCallback<ShouldRetryOperation>) {
    this.shouldRetryOperationCallback = shouldRetryOperationCallback;
  }

  async tryOperation(): Promise<ShouldRetryOperation extends true ? T | undefined : T> {
    if (!this.operation) {
      throw new Error("ChromeTabOperationRetryHandler::operation is not set");
    }

    try {
      return await this.operation;
    } catch (error) {
      // @ts-ignore
      if (error?.message !== "Tabs cannot be edited right now (user may be dragging a tab).") {
        throw error;
      }

      console.log(`ChromeTabEditOperationerWithUserInteractionHandler::handled user interaction: `, this.operation.toString());
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
