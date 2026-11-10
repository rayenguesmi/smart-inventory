import { resizeImage } from './image';

export interface OcrResult {
  text: string;
  /** 0–100 as reported by Tesseract for the whole page. This is NOT a guarantee of correctness. */
  confidence: number;
  reference?: string;
  model?: string;
  name?: string;
}

const REF_LABEL = /(?:r[ée]f(?:[ée]rence)?|art(?:icle)?|p\/n|pn|sku|code(?:\s*art)?|item)\.?\s*[:#\-]?\s*([A-Z0-9][A-Z0-9\-_/.]{2,30})/i;
const MODEL_LABEL = /(?:mod[èe]le?|model|type|mod)\.?\s*[:#\-]?\s*([A-Z0-9][A-Z0-9\-_/.]{1,30})/i;
const CODE_LIKE = /\b(?=[A-Z0-9\-_/.]*\d)(?=[A-Z0-9\-_/.]*[A-Z])[A-Z0-9][A-Z0-9\-_/.]{3,23}\b/;

/** Heuristic extraction. Anything not clearly found stays undefined — nothing is invented. */
export function parseOcrText(text: string, confidence: number): OcrResult {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter((l) => l.length > 1);
  let reference: string | undefined;
  let model: string | undefined;
  for (const l of lines) {
    if (!reference) reference = REF_LABEL.exec(l)?.[1];
    if (!model) model = MODEL_LABEL.exec(l)?.[1];
  }
  if (!reference) {
    for (const l of lines) {
      const m = CODE_LIKE.exec(l.toUpperCase());
      if (m) {
        reference = m[0];
        break;
      }
    }
  }
  const labelled = /(?:r[ée]f|art|p\/n|sku|code|mod|type|lot|date|qty|qt[ée]|poids|weight|made|fabriqu)/i;
  const name = lines
    .filter((l) => l.length >= 4 && !labelled.test(l))
    .map((l) => ({ l, letters: (l.match(/\p{L}/gu) ?? []).length / l.length }))
    .filter((x) => x.letters >= 0.6)
    .sort((a, b) => b.l.length - a.l.length)[0]?.l;
  return { text: lines.join('\n'), confidence, reference, model, name };
}

export async function runOcr(file: Blob, onProgress: (ratio: number, status: string) => void): Promise<OcrResult> {
  const input = await resizeImage(file, 1600, 0.9);
  // Loaded on demand: the OCR engine is large and only needed on this screen.
  const { createWorker } = await import('tesseract.js');
  const worker = await createWorker(['eng', 'fra'], 1, {
    logger: (m: { status: string; progress: number }) => onProgress(m.progress ?? 0, m.status),
  });
  try {
    const { data } = await worker.recognize(input);
    return parseOcrText(data.text ?? '', data.confidence ?? 0);
  } finally {
    await worker.terminate();
  }
}
