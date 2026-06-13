import { describe, it, expect } from 'vitest';
import { escapeXml } from './xml.js';

describe('escapeXml', () => {
  it('& をエスケープする', () => {
    expect(escapeXml('a & b')).toBe('a &amp; b');
  });
  it('< をエスケープする', () => {
    expect(escapeXml('<tag>')).toBe('&lt;tag&gt;');
  });
  it('> をエスケープする', () => {
    expect(escapeXml('a > b')).toBe('a &gt; b');
  });
  it('" をエスケープする', () => {
    expect(escapeXml('"quoted"')).toBe('&quot;quoted&quot;');
  });
  it("' をエスケープする", () => {
    expect(escapeXml("it's")).toBe('it&apos;s');
  });
  it('複合エスケープ', () => {
    expect(escapeXml('<tag> & "quoted" \'apos\'')).toBe('&lt;tag&gt; &amp; &quot;quoted&quot; &apos;apos&apos;');
  });
  it('& を二重エスケープしない', () => {
    expect(escapeXml('a&b')).toBe('a&amp;b');
  });
  it('特殊文字なし', () => {
    expect(escapeXml('hello world')).toBe('hello world');
  });
});
