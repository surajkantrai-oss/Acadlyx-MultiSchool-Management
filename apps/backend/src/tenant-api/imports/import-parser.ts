import { IMPORT_MAX_BYTES, IMPORT_MAX_ROWS } from '@acadlyx/validation';
import { parse } from 'csv-parse/sync';
import ExcelJS from 'exceljs';
import { badRequest } from '../../common/errors/domain-errors.js';

export interface ParsedRow {
  rowNumber: number;
  values: Record<string, string>;
  /** Cells that could not be taken as plain values (formulas, error cells, wrong column count). */
  problems: { field: string; code: string; message: string }[];
}

export interface ParsedFile {
  headers: string[];
  rows: ParsedRow[];
}

/** Guard against decompression bombs: total cell text we accept from one workbook. */
const MAX_TEXT_CHARS = 40 * 1024 * 1024;

const fileError = (code: string, message: string) => badRequest(code, message);

/** Header cell → canonical column name (`Admission Number` → `admission_number`). */
export function canonicalHeader(h: string): string {
  return h
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
}

/**
 * Parses an uploaded CSV/XLSX buffer as UNTRUSTED input:
 *  - only .csv/.xlsx; size ≤ 5 MB; ≤ 5,000 data rows; first worksheet only;
 *  - XLSX formulas are NEVER evaluated — a formula cell makes the row invalid (FORMULA_NOT_ALLOWED);
 *    macros/VBA are never loaded (exceljs does not execute anything);
 *  - CSV must be valid UTF-8 text (no NUL bytes, not a disguised archive);
 *  - the raw file is not kept by the caller — only these normalised strings.
 */
export async function parseUpload(buffer: Buffer, filename: string): Promise<ParsedFile> {
  if (buffer.length === 0) throw fileError('IMPORT_EMPTY', 'The file is empty');
  if (buffer.length > IMPORT_MAX_BYTES)
    throw fileError('IMPORT_FILE_TOO_LARGE', 'The file is larger than 5 MB');
  const ext = filename.toLowerCase().split('.').pop();
  const isZip = buffer.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
  if (ext === 'xlsx') {
    if (!isZip) throw fileError('IMPORT_FILE_UNREADABLE', 'The file is not a valid .xlsx workbook');
    return parseXlsx(buffer);
  }
  if (ext === 'csv') {
    if (isZip || buffer.includes(0))
      throw fileError('IMPORT_FILE_UNREADABLE', 'The file is not a plain-text CSV');
    return parseCsv(buffer);
  }
  throw fileError('IMPORT_FILE_TYPE', 'Upload a .csv or .xlsx file');
}

function parseCsv(buffer: Buffer): ParsedFile {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    throw fileError('IMPORT_FILE_UNREADABLE', 'The CSV must be UTF-8 encoded');
  }
  let records: { record: string[]; info: { lines: number } }[];
  try {
    records = parse(text, {
      bom: true,
      info: true,
      relax_column_count: true,
      skip_empty_lines: true,
      max_record_size: 32_768,
      relax_quotes: true,
      to: IMPORT_MAX_ROWS + 2,
    }) as unknown as { record: string[]; info: { lines: number } }[];
  } catch {
    throw fileError(
      'IMPORT_FILE_UNREADABLE',
      'The CSV could not be read (check quotes and separators)',
    );
  }
  const [header, ...data] = records;
  if (!header) throw fileError('IMPORT_EMPTY', 'The file has no header row');
  const headers = header.record.map(canonicalHeader);
  const rows: ParsedRow[] = [];
  for (const { record, info } of data) {
    if (record.every((v) => v.trim() === '')) continue;
    const problems: ParsedRow['problems'] = [];
    if (record.length !== headers.length)
      problems.push({
        field: '*',
        code: 'COLUMN_COUNT',
        message: `Expected ${String(headers.length)} columns, found ${String(record.length)}`,
      });
    rows.push({ rowNumber: info.lines, values: toValues(headers, record), problems });
  }
  enforceRowLimit(rows.length);
  return { headers, rows };
}

async function parseXlsx(buffer: Buffer): Promise<ParsedFile> {
  // Decompression-bomb guard BEFORE inflating anything: the zip's own central directory must
  // declare a bounded number of entries and total uncompressed size.
  const zip = zipStats(buffer);
  if (!zip) throw fileError('IMPORT_FILE_UNREADABLE', 'The file is not a valid .xlsx workbook');
  if (zip.entries > MAX_ZIP_ENTRIES || zip.uncompressed > MAX_UNCOMPRESSED_BYTES)
    throw fileError('IMPORT_FILE_TOO_LARGE', 'The workbook contains too much data');
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  } catch {
    throw fileError('IMPORT_FILE_UNREADABLE', 'The workbook could not be read');
  }
  const sheet = wb.worksheets[0]; // first worksheet only
  if (!sheet) throw fileError('IMPORT_EMPTY', 'The workbook has no worksheet');
  let headers: string[] | null = null;
  const rows: ParsedRow[] = [];
  let chars = 0;
  for (let r = 1; r <= sheet.rowCount; r += 1) {
    const row = sheet.getRow(r);
    const cells: string[] = [];
    const problems: ParsedRow['problems'] = [];
    const count = Math.max(row.cellCount, headers?.length ?? 0);
    for (let i = 1; i <= count; i += 1) {
      const { text, problem } = cellText(row.getCell(i).value);
      chars += text.length;
      if (chars > MAX_TEXT_CHARS)
        throw fileError('IMPORT_FILE_TOO_LARGE', 'The workbook contains too much data');
      cells.push(text);
      if (problem) problems.push({ field: headers?.[i - 1] ?? `column ${String(i)}`, ...problem });
    }
    if (!headers) {
      if (cells.every((c) => c.trim() === '')) continue;
      headers = cells.map(canonicalHeader);
      while (headers.length > 0 && headers[headers.length - 1] === '') headers.pop();
      if (problems.length > 0)
        throw fileError('IMPORT_HEADERS_INVALID', 'Header cells must be plain text');
      continue;
    }
    if (cells.every((v) => v.trim() === '') && problems.length === 0) continue;
    rows.push({ rowNumber: r, values: toValues(headers, cells), problems });
    if (rows.length > IMPORT_MAX_ROWS) break;
  }
  if (!headers) throw fileError('IMPORT_EMPTY', 'The workbook has no header row');
  enforceRowLimit(rows.length);
  return { headers, rows };
}

const MAX_ZIP_ENTRIES = 2_000;
const MAX_UNCOMPRESSED_BYTES = 60 * 1024 * 1024;

/**
 * Reads the ZIP end-of-central-directory + central directory (no decompression) and returns the
 * entry count and total DECLARED uncompressed size. Zip64 archives are refused (a ≤5 MB
 * spreadsheet never needs them). Returns null for anything that is not a well-formed zip.
 */
export function zipStats(buf: Buffer): { entries: number; uncompressed: number } | null {
  const minEocd = 22;
  if (buf.length < minEocd) return null;
  let eocd = -1;
  for (let i = buf.length - minEocd; i >= Math.max(0, buf.length - minEocd - 0xffff); i -= 1) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return null;
  const entries = buf.readUInt16LE(eocd + 10);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  if (entries === 0xffff || cdOffset === 0xffffffff) return null;
  let pos = cdOffset;
  let uncompressed = 0;
  for (let n = 0; n < entries; n += 1) {
    if (pos + 46 > buf.length || buf.readUInt32LE(pos) !== 0x02014b50) return null;
    const size = buf.readUInt32LE(pos + 24);
    if (size === 0xffffffff) return null;
    uncompressed += size;
    pos +=
      46 + buf.readUInt16LE(pos + 28) + buf.readUInt16LE(pos + 30) + buf.readUInt16LE(pos + 32);
  }
  return { entries, uncompressed };
}

function enforceRowLimit(count: number): void {
  if (count > IMPORT_MAX_ROWS)
    throw fileError(
      'IMPORT_TOO_MANY_ROWS',
      `The file has more than ${String(IMPORT_MAX_ROWS)} data rows — split it into smaller files`,
    );
}

function toValues(headers: string[], cells: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((h, i) => {
    if (h) out[h] = (cells[i] ?? '').trim();
  });
  return out;
}

/** Plain text of an exceljs cell value. Formulas/errors are flagged, never evaluated. */
function cellText(value: ExcelJS.CellValue): {
  text: string;
  problem?: { code: string; message: string };
} {
  if (value === null || value === undefined) return { text: '' };
  if (typeof value === 'string') return { text: value };
  if (typeof value === 'number')
    return { text: Number.isInteger(value) ? String(value) : String(value) };
  if (typeof value === 'boolean') return { text: value ? 'yes' : 'no' };
  if (value instanceof Date) return { text: value.toISOString().slice(0, 10) };
  if (typeof value === 'object') {
    if ('formula' in value || 'sharedFormula' in value)
      return {
        text: '',
        problem: {
          code: 'FORMULA_NOT_ALLOWED',
          message: 'Formulas are not allowed — paste values only',
        },
      };
    if ('error' in value)
      return {
        text: '',
        problem: { code: 'CELL_ERROR', message: 'The cell contains a spreadsheet error' },
      };
    if ('richText' in value) return { text: value.richText.map((r) => r.text).join('') };
    if ('text' in value && typeof value.text === 'string') return { text: value.text };
  }
  return { text: '', problem: { code: 'UNSUPPORTED_CELL', message: 'Unsupported cell content' } };
}
