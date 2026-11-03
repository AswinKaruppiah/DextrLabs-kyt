export class DeadlineError extends Error {
  constructor() {
    super("Behaviour check time limit reached");
    this.name = "DeadlineError";
  }
}

/** Resolves like `promise`, or rejects with DeadlineError once `deadline` (ms timestamp) passes. */
export function withinDeadline(promise, deadline) {
  let timer;
  const expire = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new DeadlineError()), Math.max(0, deadline - Date.now()));
  });
  return Promise.race([promise, expire]).finally(() => clearTimeout(timer));
}
