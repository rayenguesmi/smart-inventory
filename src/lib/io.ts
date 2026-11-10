/** Spreadsheet / CSV helpers. SheetJS is loaded lazily so it only costs bytes when used. */
import { saveBlob } from './util';

export type Row = Record<string, string | number | boolean | null | undefined>;

const csvCell = (v: unknown): string => {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",;\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};

export function rowsToCsv(rows: Row[]): string {
  if (!rows.length) return '';
  const headers = Object.keys(rows[0]);
  const lines = [headers.map(csvCell).join(';')];
  for (const r of rows) lines.push(headers.map((h) => csvCell(r[h])).join(';'));
  return lines.join('\r\n');
}

/** UTF-8 with BOM and ';' separator so Excel (FR/AR locales) opens accents and Arabic correctly. */
export function downloadCsv(filename: string, rows: Row[]) {
  const blob = new Blob(['﻿', rowsToCsv(rows)], { type: 'text/csv;charset=utf-8' });
  saveBlob(blob, filename.endsWith('.csv') ? filename : filename + '.csv');
}

export async function buildXlsx(sheets: { name: string; rows: Row[] }[]): Promise<Blob> {
  const XLSX = await import('xlsx');
  const wb = XLSX.utils.book_new();
  for (const s of sheets) {
    const ws = XLSX.utils.json_to_sheet(s.rows.length ? s.rows : [{}]);
    if (s.rows.length) {
      const headers = Object.keys(s.rows[0]);
      ws['!cols'] = headers.map((h) => ({
        wch: Math.min(40, Math.max(h.length + 2, ...s.rows.slice(0, 200).map((r) => String(r[h] ?? '').length + 2))),
      }));
    }
    XLSX.utils.book_append_sheet(wb, ws, s.name.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31));
  }
  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  return new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

export async function downloadXlsx(filename: string, sheets: { name: string; rows: Row[] }[]) {
  saveBlob(await buildXlsx(sheets), filename.endsWith('.xlsx') ? filename : filename + '.xlsx');
}

export interface ParsedSheet {
  sheetNames: string[];
  sheet: string;
  /** first row = headers */
  rows: string[][];
}

/** Parse .xlsx/.xls/.csv/.tsv into a string matrix. Numbers are kept as plain digits (no 6.29E+12). */
export async function parseSpreadsheet(file: File, sheetName?: string): Promise<ParsedSheet> {
  const XLSX = await import('xlsx');
  const isText = /\.(csv|tsv|txt)$/i.test(file.name);
  let wb;
  if (isText) {
    const text = (await file.text()).replace(/^﻿/, '');
    wb = XLSX.read(text, { type: 'string', raw: true, FS: guessDelimiter(text) });
  } else {
    wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
  }
  const sheet = sheetName && wb.SheetNames.includes(sheetName) ? sheetName : wb.SheetNames[0];
  if (!sheet) throw new Error('EMPTY');
  const raw = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[sheet], { header: 1, defval: '', raw: true, blankrows: false });
  const rows = raw.map((r) => r.map((c) => (c === null || c === undefined ? '' : String(c).trim())));
  return { sheetNames: wb.SheetNames, sheet, rows };
}

function guessDelimiter(text: string): string {
  const head = text.split(/\r?\n/).slice(0, 5).join('\n');
  const counts: [string, number][] = [
    [';', (head.match(/;/g) ?? []).length],
    [',', (head.match(/,/g) ?? []).length],
    ['\t', (head.match(/\t/g) ?? []).length],
  ];
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][1] > 0 ? counts[0][0] : ',';
}
