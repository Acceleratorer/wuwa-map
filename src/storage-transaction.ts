interface TransactionEventSource {
  readonly error?: DOMException | null;
  addEventListener(
    type: "complete" | "abort" | "error",
    listener: () => void,
  ): void;
}

export function waitForTransactionCompletion(
  transaction: TransactionEventSource,
): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.addEventListener("complete", () => resolve());
    transaction.addEventListener("abort", () =>
      reject(transaction.error ?? new Error("IndexedDB transaction aborted")),
    );
    transaction.addEventListener("error", () =>
      reject(transaction.error ?? new Error("IndexedDB transaction failed")),
    );
  });
}
