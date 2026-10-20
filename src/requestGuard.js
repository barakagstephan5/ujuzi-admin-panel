// Binds an async result to the request that started it. A response is used only
// if no newer request, and no input change, has superseded it since.
export function createRequestGuard() {
  let generation = 0;
  return {
    begin() {
      const ticket = ++generation;
      return () => ticket === generation;
    },
    cancel() { generation += 1; },
  };
}

export const sameEmail = (a, b) => String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase();
