/* ─────────────────────────────────────────────────
   FormPilot — Reading a résumé file
   Browser-only: pdf.js and DecompressionStream. Kept out of resume.ts so the
   service worker, which only needs the prompt and the sanitiser, never bundles
   a PDF engine — and so `import.meta.url` never lands in an IIFE bundle.
   ───────────────────────────────────────────────── */

import { RESUME_LIMITS } from './resume.ts';

export const ACCEPTED_TYPES = '.pdf,.docx,.txt,.md,.rtf';

/* ─── DOCX ───
   A .docx is a zip holding word/document.xml. Chrome can inflate a raw
   deflate stream natively, so this needs no library: find the entry in the
   central directory, inflate it, strip the tags. */
async function inflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function extractDocx(buffer: ArrayBuffer): Promise<string> {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  const decoder = new TextDecoder();

  // Walk local file headers (PK\x03\x04) looking for word/document.xml.
  for (let i = 0; i < bytes.length - 4; i++) {
    if (view.getUint32(i, true) !== 0x04034b50) continue;
    const method = view.getUint16(i + 8, true);
    const compressedSize = view.getUint32(i + 18, true);
    const nameLength = view.getUint16(i + 26, true);
    const extraLength = view.getUint16(i + 28, true);
    const nameStart = i + 30;
    const name = decoder.decode(bytes.subarray(nameStart, nameStart + nameLength));
    if (name !== 'word/document.xml') continue;

    const dataStart = nameStart + nameLength + extraLength;
    // A streamed zip writes sizes in a trailing descriptor, leaving 0 here.
    const end = compressedSize > 0 ? dataStart + compressedSize : bytes.length;
    const raw = bytes.subarray(dataStart, end);
    const xml = decoder.decode(method === 0 ? raw : await inflateRaw(raw));
    return xmlToText(xml);
  }
  throw new Error('That .docx has no readable document inside it.');
}

function xmlToText(xml: string): string {
  return xml
    .replace(/<w:p[ >]/g, '\n<w:p ')          // paragraphs become line breaks
    .replace(/<w:tab\b[^>]*\/?>/g, '\t')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/* ─── RTF ─── strip control words, keep the words. */
function extractRtf(text: string): string {
  return text
    .replace(/\\'([0-9a-f]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\par[d]?\b/g, '\n')
    .replace(/\\[a-z]+-?\d*\s?/gi, '')
    .replace(/[{}]/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/* ─── PDF ───
   pdf.js is loaded on demand so its ~300KB never touches the popup's startup
   path — most sessions never import a résumé. */
async function extractPdf(buffer: ArrayBuffer): Promise<string> {
  const pdfjs = await import('pdfjs-dist');

  // The worker is constructed here rather than left to pdf.js's own workerSrc
  // resolution. That path tries to detect cross-origin sources and can fall
  // back to a blob: worker, which this extension's CSP forbids — the failure
  // shows up as a load that never finishes rather than an error.
  const worker = new Worker(new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url), { type: 'module' });

  // A résumé is text and images: nothing in the file is allowed to fetch or
  // run. The worker is bundled locally, so no remote code is involved either.
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(buffer),
    worker: new pdfjs.PDFWorker({ port: worker } as any),
    disableAutoFetch: true,
    disableFontFace: true,
    isEvalSupported: false,
  } as any);

  // Belt and braces: a malformed PDF must surface as a message, not a spinner.
  const doc = await Promise.race([
    loadingTask.promise,
    new Promise<never>((_, reject) => setTimeout(
      () => reject(new Error('That PDF took too long to read. Try exporting it again, or paste the text into “About you”.')),
      45_000,
    )),
  ]);

  const pages: string[] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const content = await (await doc.getPage(n)).getTextContent();
    let line = '';
    let lastY: number | null = null;
    const out: string[] = [];
    for (const item of content.items as any[]) {
      if (!('str' in item)) continue;
      const y = item.transform?.[5];
      // A new baseline means a new line — without this a two-column CV comes
      // out as one run-on paragraph.
      if (lastY !== null && Math.abs(y - lastY) > 3) { out.push(line.trim()); line = ''; }
      line += item.str + (item.hasEOL ? '\n' : ' ');
      lastY = y;
    }
    out.push(line.trim());
    pages.push(out.filter(Boolean).join('\n'));
  }
  await loadingTask.destroy();
  worker.terminate();
  return pages.join('\n\n').replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

/** Reads a résumé file into plain text, entirely on this device. */
export async function fileToText(file: File): Promise<string> {
  if (file.size > RESUME_LIMITS.fileBytes) {
    throw new Error(`That file is ${(file.size / 1024 / 1024).toFixed(1)}MB — the limit is ${RESUME_LIMITS.fileBytes / 1024 / 1024}MB.`);
  }

  const name = file.name.toLowerCase();
  let text: string;

  if (name.endsWith('.pdf')) text = await extractPdf(await file.arrayBuffer());
  else if (name.endsWith('.docx')) text = await extractDocx(await file.arrayBuffer());
  else if (name.endsWith('.rtf')) text = extractRtf(await file.text());
  else if (/\.(txt|md|markdown)$/.test(name)) text = await file.text();
  else if (name.endsWith('.doc')) throw new Error('Old .doc files can’t be read. Save as .docx or PDF and try again.');
  else throw new Error('Upload a PDF, DOCX, RTF, TXT or MD file.');

  text = text.trim();
  if (text.length < 40) {
    throw new Error('No text found. If this is a scanned PDF the pages are images — export a text PDF, or paste the text into “About you”.');
  }
  return text.slice(0, RESUME_LIMITS.text);
}

