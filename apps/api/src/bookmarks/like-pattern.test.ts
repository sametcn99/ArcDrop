import { describe, expect, it } from 'bun:test';
import { containsPattern, escapeLikePattern } from './like-pattern';

describe('LIKE pattern helpers', () => {
  it('escapes LIKE metacharacters', () => {
    expect(escapeLikePattern('plain')).toBe('plain');
    expect(escapeLikePattern('50%')).toBe('50\\%');
    expect(escapeLikePattern('under_score')).toBe('under\\_score');
    expect(escapeLikePattern('back\\slash')).toBe('back\\\\slash');
    expect(escapeLikePattern('%_\\')).toBe('\\%\\_\\\\');
  });

  it('wraps into a contains-pattern', () => {
    expect(containsPattern('abc')).toBe('%abc%');
    expect(containsPattern('a_b%c')).toBe('%a\\_b\\%c%');
  });
});
