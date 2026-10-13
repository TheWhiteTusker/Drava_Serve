import { describe, expect, it } from 'vitest';
import { slugify, tableCodeOf, tableSlug } from './slugs';

describe('slugs', () => {
  it('makes readable URL parts', () => {
    expect(slugify('Paneer Tikka (Half)')).toBe('paneer-tikka-half');
    expect(slugify('  Crème brûlée ')).toBe('creme-brulee');
    expect(slugify('***')).toBe('item');
  });
  it('a table link is its name plus its code, and only the code is read back', () => {
    expect(tableSlug({ name: 'Patio 2', code: 'k7q2' })).toBe('patio-2-k7q2');
    expect(tableCodeOf('patio-2-k7q2')).toBe('k7q2');
    expect(tableCodeOf('old-name-K7Q2')).toBe('k7q2');
  });
});
