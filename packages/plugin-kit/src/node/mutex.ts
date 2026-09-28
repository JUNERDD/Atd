/** Runs tasks one at a time in call order; a failed task does not block the next one. */
export interface Mutex {
  run<T>(task: () => Promise<T>): Promise<T>;
}

export function createMutex(): Mutex {
  let tail: Promise<unknown> = Promise.resolve();
  return {
    run(task) {
      const result = tail.then(task);
      tail = result.catch(() => {});
      return result;
    },
  };
}
