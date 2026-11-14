import { describe, expect, it } from 'bun:test';
import { parseCsvRows, splitSemicolonList } from './csv-fields';

describe('parseCsvRows (RFC 4180-ish)', () => {
  it('splits plain records on newlines', () => {
    expect(parseCsvRows('a,b,c\n1,2,3\n')).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
    ]);
  });

  it('handles CRLF and trailing newline without a phantom record', () => {
    expect(parseCsvRows('a,b\r\nc,d\r\n')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
  });

  it('keeps commas inside quoted fields', () => {
    expect(parseCsvRows('"x, y",z\n')).toEqual([['x, y', 'z']]);
  });

  it('unescapes doubled quotes and keeps newlines inside quotes', () => {
    expect(parseCsvRows('"say ""hi""","line1\nline2"\n')).toEqual([['say "hi"', 'line1\nline2']]);
  });

  it('tolerates an unterminated quote at EOF (rest is one field)', () => {
    expect(parseCsvRows('a,"unterminated')).toEqual([['a', 'unterminated']]);
  });

  it('skips empty lines but preserves genuinely empty fields', () => {
    expect(parseCsvRows('a,,c\n\n\nd,e,f')).toEqual([
      ['a', '', 'c'],
      ['d', 'e', 'f'],
    ]);
  });

  it('accepts a lone CR as a record break (lenient)', () => {
    expect(parseCsvRows('a,b\rc,d')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
  });
});

describe('splitSemicolonList', () => {
  it('splits and trims, dropping empties', () => {
    expect(splitSemicolonList(' a ; b ;; c ')).toEqual(['a', 'b', 'c']);
  });
  it('returns empty for absent/blank input', () => {
    expect(splitSemicolonList(undefined)).toEqual([]);
    expect(splitSemicolonList('  ')).toEqual([]);
  });
});
