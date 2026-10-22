export interface History<T> { past: T[]; present: T; future: T[] }

export function initialHistory<T>(present: T): History<T> { return { past: [], present, future: [] }; }

export function commitHistory<T>(history: History<T>, next: T): History<T> {
  if (JSON.stringify(history.present) === JSON.stringify(next)) return history;
  return { past: [...history.past.slice(-99), history.present], present: next, future: [] };
}

export function undoHistory<T>(history: History<T>): History<T> {
  if (!history.past.length) return history;
  return { past: history.past.slice(0, -1), present: history.past.at(-1)!, future: [history.present, ...history.future] };
}

export function redoHistory<T>(history: History<T>): History<T> {
  if (!history.future.length) return history;
  return { past: [...history.past, history.present], present: history.future[0], future: history.future.slice(1) };
}
