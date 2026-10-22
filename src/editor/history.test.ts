import { describe, expect, it } from 'vitest';
import { commitHistory, initialHistory, redoHistory, undoHistory } from './history';

describe('composition history', () => {
  it('restores complete states and invalidates redo after a new edit', () => {
    const one = { x: 18, clearance: 2 };
    const two = { x: 19, clearance: 2 };
    const three = { x: 19, clearance: 3 };
    let history = initialHistory(one);
    history = commitHistory(history, two);
    history = commitHistory(history, three);
    history = undoHistory(history);
    expect(history.present).toEqual(two);
    history = redoHistory(history);
    expect(history.present).toEqual(three);
    history = undoHistory(history);
    history = commitHistory(history, { x: 17, clearance: 1 });
    expect(history.future).toHaveLength(0);
    expect(undoHistory(history).present).toEqual(two);
  });

  it('does not record unchanged compositions and caps the past at 100', () => {
    let history = initialHistory({ x: 0 });
    expect(commitHistory(history, { x: 0 })).toBe(history);
    for (let x = 1; x <= 110; x++) history = commitHistory(history, { x });
    expect(history.past).toHaveLength(100);
    expect(history.past[0]).toEqual({ x: 10 });
  });
});
