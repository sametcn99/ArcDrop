import { describe, expect, it } from 'bun:test';
import {
  detectLoginOrPaywall,
  extractBlockTextFromHtml,
  extractHtmlContent,
  extractPdfContent,
  extractPlainTextContent,
  MAX_ARCHIVE_TEXT_CHARS,
  sanitizeExtractedHtml,
  truncateForDb,
} from './content-extractor';

function buildSimplePdf(text: string): Uint8Array {
  const escaped = text.replaceAll('\\', '\\\\').replaceAll('(', '\\(').replaceAll(')', '\\)');
  const stream = `BT\n/F1 12 Tf\n72 720 Td\n(${escaped}) Tj\nET\n`;
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n',
    `4 0 obj\n<< /Length ${Buffer.byteLength(stream, 'utf8')} >>\nstream\n${stream}endstream\nendobj\n`,
    '5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (const obj of objects) {
    offsets.push(Buffer.byteLength(pdf, 'utf8'));
    pdf += obj;
  }
  const xrefOffset = Buffer.byteLength(pdf, 'utf8');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) {
    pdf += `${String(off).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(pdf, 'utf8'));
}

describe('content-extractor (M17)', () => {
  it('extracts readable article HTML and plain text via Readability + linkedom', () => {
    const html = `<!doctype html>
      <html>
        <head><title>Deep Systems Post</title></head>
        <body>
          <nav><a href="/home">Home</a><a href="/about">About</a></nav>
          <main>
            <article>
              <h1>Storage Engines Explained</h1>
              <p>B-trees optimize random reads on solid-state drives while LSM trees buffer sequential writes.</p>
              <p>Compaction merges sorted runs in the background so query latency remains predictable under heavy load.</p>
              <p>Checkpointing flushes dirty pages safely to durable storage.</p>
            </article>
          </main>
          <footer>Copyright 2026</footer>
        </body>
      </html>`;

    const extracted = extractHtmlContent(html, 'https://example.com/posts/storage');
    expect(extracted).not.toBeNull();
    expect(extracted!.title).toBe('Deep Systems Post');
    expect(extracted!.textContent).toContain('B-trees optimize random reads');
    expect(extracted!.textContent).toContain('Compaction merges sorted runs');
    expect(extracted!.htmlContent).toContain('Storage Engines Explained');
    expect(extracted!.truncated).toBe(false);
  });

  it('sanitizes scripts, iframes, event handlers, and javascript: URIs from extracted HTML', () => {
    const dirty = `
      <article>
        <h2>Safe Heading</h2>
        <p onclick="alert(1)" onmouseover="steal()">Paragraph with <a href="javascript:alert(2)">bad link</a> and <a href="/docs/intro">good link</a>.</p>
        <script>window.pwn = true;</script>
        <iframe src="https://evil.example/embed"></iframe>
        <img src="data:text/html,<script>alert(3)</script>" onerror="alert(4)" alt="pic">
      </article>
    `;
    const clean = sanitizeExtractedHtml(dirty, 'https://docs.example.com/post/1');
    expect(clean).toContain('Safe Heading');
    expect(clean).toContain('https://docs.example.com/docs/intro');
    expect(clean).not.toContain('<script');
    expect(clean).not.toContain('<iframe');
    expect(clean).not.toContain('onclick');
    expect(clean).not.toContain('onmouseover');
    expect(clean).not.toContain('onerror');
    expect(clean).not.toContain('javascript:');
    expect(clean).not.toContain('data:text/html');
  });

  it('preserves block boundaries and Turkish UTF-8 characters when extracting plain text', () => {
    const html = `<article><p>İstanbul boğazı akşamüstü</p><p>gümüş ışıklarıyla parlıyor.</p></article>`;
    const text = extractBlockTextFromHtml(html);
    expect(text).toBe('İstanbul boğazı akşamüstü\ngümüş ışıklarıyla parlıyor.');
    expect(text).not.toContain('akşamüstügümüş');
  });

  it('extracts plain text from valid PDF bytes via unpdf', async () => {
    const pdfBytes = buildSimplePdf('ArcDrop PDF Archive Verification');
    const extracted = await extractPdfContent(pdfBytes);
    expect(extracted).not.toBeNull();
    expect(extracted!.textContent).toContain('ArcDrop PDF Archive Verification');
    expect(extracted!.htmlContent).toContain('<article>');
    expect(extracted!.title).toBeNull();
  });

  it('extracts plain text documents cleanly', () => {
    const extracted = extractPlainTextContent('Line one\r\nLine two\u0000');
    expect(extracted).not.toBeNull();
    expect(extracted!.textContent).toBe('Line one\nLine two');
    expect(extracted!.htmlContent).toContain('<pre>Line one\nLine two</pre>');
    expect(extractPlainTextContent('   \n  ')).toBeNull();
  });

  it('truncates DB text at word boundaries without exceeding MAX_ARCHIVE_TEXT_CHARS', () => {
    const longText = `${'word '.repeat(100_050)}tail`;
    const truncated = truncateForDb(longText);
    expect(truncated.length).toBeLessThanOrEqual(MAX_ARCHIVE_TEXT_CHARS);
    expect(truncated.endsWith('word')).toBe(true);
  });

  it('detects paywalls and login walls while sparing normal articles', () => {
    expect(
      detectLoginOrPaywall(
        '<html><head><meta property="article:content_tier" content="locked"></head><body><p>Preview</p></body></html>',
        'https://news.example/story',
        'Preview',
      ),
    ).toBe('paywall-detected');

    expect(
      detectLoginOrPaywall(
        '<html><body><form><input type="password" name="pw"></form><p>Please sign in</p></body></html>',
        'https://app.example/login',
        'Please sign in',
        'https://app.example/private/doc',
      ),
    ).toBe('login-wall-detected');

    expect(
      detectLoginOrPaywall(
        '<html><body><article><p>Full open engineering article with lots of detail.</p></article></body></html>',
        'https://blog.example/open',
        'Full open engineering article with lots of detail.',
      ),
    ).toBeNull();
  });
});
