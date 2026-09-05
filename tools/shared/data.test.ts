import { describe, expect, it } from 'vitest';
import { normalizeById } from './data';

describe('normalizeById', () => {
  it('converts an array of { id } items into a Record keyed by id', () => {
    const result = normalizeById<{ id: string; name: string }>([
      { id: 'a', name: 'Alpha' },
      { id: 'b', name: 'Bravo' },
    ]);
    expect(result).toEqual({ a: { id: 'a', name: 'Alpha' }, b: { id: 'b', name: 'Bravo' } });
  });

  it('passes an already-keyed object through unchanged', () => {
    const input = { a: { id: 'a', name: 'Alpha' } };
    expect(normalizeById(input)).toEqual(input);
  });

  it('skips array entries missing a string id rather than throwing', () => {
    const result = normalizeById<{ id: string }>([{ id: 'a' }, { notAnId: true } as unknown as { id: string }, null as unknown as { id: string }]);
    expect(Object.keys(result)).toEqual(['a']);
  });

  it('returns an empty record for null/undefined input', () => {
    expect(normalizeById(null)).toEqual({});
    expect(normalizeById(undefined)).toEqual({});
  });
});
