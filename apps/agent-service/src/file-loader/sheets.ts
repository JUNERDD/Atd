import * as XLSX from 'xlsx';
import * as cptable from 'xlsx/dist/cpexcel.full.mjs';
import { counted, documentText } from './document.js';
import type { ExtractOutcome } from './jobs.js';
import { ExtractOutputs } from './outputs.js';
import { writeExtractedFile } from './output-write.js';
import { sheetBudget } from './sheet-budget.js';
import { flagSheetFormulas } from './sheet-formulas.js';
import { storedCopy } from './zip.js';

// Legacy .xls files store text in Windows code pages (GBK, Shift_JIS, …); SheetJS decodes them
// only with these tables.
XLSX.set_cptable(cptable);

/** Data rows shown per sheet, after its header row. SheetJS limits absolute worksheet row numbers. */
const MAX_ROWS = 10_000;
/** Sheets shown in the preview; the output writer owns the separate whole-sheet limit. */
const MAX_SHEETS = 50;

/** A bounded workbook preview, with complete CSV files when the parsing budget allows them. */
export function sheetDocument(
  bytes: Uint8Array,
  label: string,
  zipped: boolean,
  out?: string,
): ExtractOutcome {
  const outputs = new ExtractOutputs(out);
  const budget = sheetBudget(bytes, zipped);
  const whole = Boolean(out) && budget.whole;
  let book: XLSX.WorkBook;
  try {
    book = XLSX.read(zipped ? storedCopy(bytes) : bytes, {
      type: 'array',
      dense: true,
      ...(whole ? {} : { sheetRows: MAX_ROWS + 1 }),
      cellDates: true,
      cellHTML: false,
      cellStyles: false,
      cellFormula: true,
      sheetStubs: true,
      bookVBA: false,
    });
  } catch (error) {
    if (error instanceof Error && /password/i.test(error.message)) return { status: 'protected' };
    throw error;
  }
  const names = book.SheetNames;
  const warnings = flagSheetFormulas(book);
  const sections: string[] = [];
  let saved = 0;
  for (const [index, name] of names.entries()) {
    const sheet = book.Sheets[name];
    const hidden = Boolean(book.Workbook?.Sheets?.[index]?.Hidden);
    const file = sheet && whole ? saveSheet(outputs, index, name, sheet, hidden) : undefined;
    if (file) saved += 1;
    if (!sheet) {
      const note = `Sheet '${name.replace(/\s+/g, ' ')}' could not be read.`;
      warnings.push(note);
      if (out) outputs.omit(note);
    }
    if (index < MAX_SHEETS)
      sections.push(sheetSection(name, sheet, hidden, file, whole, budget.narrowPreview));
  }
  if (!whole) {
    const note = out
      ? 'Whole sheets were not saved because this workbook exceeds the whole-sheet memory allowance.'
      : 'Whole sheets were not saved because no extraction directory was requested.';
    warnings.push(note);
    if (out) outputs.omit(note);
  }
  if (names.length > MAX_SHEETS) {
    const kept =
      saved === names.length
        ? 'every sheet is whole in sheets/'
        : saved
          ? `${saved} sheets are saved whole in sheets/; other sheets were not saved whole`
          : 'whole sheets were not saved';
    warnings.push(`Only the first ${MAX_SHEETS} of ${names.length} sheets are included; ${kept}`);
  }
  const files = outputs.summary();
  return {
    status: 'text',
    ...(files ? { files } : {}),
    text: documentText({
      label,
      facts: [counted(names.length, 'sheet')],
      included:
        'cell values as CSV; formulas use cached results when available and are not recalculated',
      warnings,
      body: sections.join('\n\n'),
    }),
  };
}

function saveSheet(
  outputs: ExtractOutputs,
  index: number,
  name: string,
  sheet: XLSX.WorkSheet,
  hidden: boolean,
): string | undefined {
  const target = outputs.sheetFile(index + 1, name);
  if (!target) return undefined;
  const range = sheet['!ref'] ?? '';
  const size = sheetSize(range);
  // CSV records follow range rows, including empty and hidden ones. Quoted cell values can
  // contain newlines, so physical text line numbers need not match worksheet row numbers.
  writeExtractedFile(
    target.absolute,
    XLSX.utils.sheet_to_csv(sheet, {
      blankrows: true,
      skipHidden: false,
      strip: false,
    }),
  );
  outputs.addSheet({ file: target.file, name, range, ...size, hidden });
  return target.file;
}

function sheetSize(ref: string | undefined): { rows: number; columns: number } {
  const range = ref ? XLSX.utils.decode_range(ref) : undefined;
  return {
    rows: range ? Math.max(0, range.e.r - range.s.r + 1) : 0,
    columns: range ? Math.max(0, range.e.c - range.s.c + 1) : 0,
  };
}

function sheetSection(
  name: string,
  sheet: XLSX.WorkSheet | undefined,
  hidden: boolean,
  file: string | undefined,
  whole: boolean,
  narrow: boolean,
): string {
  const title = name.replace(/\s+/g, ' ');
  const visibility = hidden ? ' [hidden]' : '';
  if (!sheet) return `## Sheet: ${title}${visibility}\n[Sheet could not be read]`;
  const read = sheet['!ref'];
  const fullRef: unknown = sheet['!fullref'];
  const full = typeof fullRef === 'string' ? fullRef : read;
  const { rows, columns } = sheetSize(full);
  const lines = [
    `## Sheet: ${title} (${counted(rows, 'row')} × ${counted(columns, 'column')})${visibility}`,
  ];
  if (!read) return lines.join('\n');
  const preview = whole ? previewSheet(sheet, narrow) : sheet;
  const csv = XLSX.utils
    .sheet_to_csv(preview, {
      blankrows: false,
      skipHidden: true,
      strip: true,
    })
    .trimEnd();
  if (csv) lines.push(csv);
  if (full !== preview['!ref']) {
    const kept = sheetSize(preview['!ref']).rows;
    const location = file ? `the whole sheet is in ${file}` : 'the whole sheet was not saved';
    lines.push(
      `[Sheet cut after row ${kept.toLocaleString('en-US')} of ${rows.toLocaleString('en-US')}; ${location}]`,
    );
  }
  return lines.join('\n');
}

/** Share cells with the whole sheet; only the preview's range changes, never the saved data. */
function previewSheet(sheet: XLSX.WorkSheet, narrow: boolean): XLSX.WorkSheet {
  const range = XLSX.utils.decode_range(sheet['!ref'] ?? 'A1');
  if (range.e.r <= MAX_ROWS) return sheet;
  if (!narrow && range.s.r > MAX_ROWS) {
    const preview = { ...sheet };
    delete preview['!ref'];
    return preview;
  }
  range.e.r = MAX_ROWS;
  if (narrow) {
    const data = sheet['!data'] ?? [];
    let lastRow = 0;
    let lastColumn = 0;
    for (let r = 0; r <= MAX_ROWS; r += 1) {
      const row = data[r];
      if (!row) continue;
      lastRow = r;
      lastColumn = Math.max(lastColumn, row.length - 1);
    }
    range.e.r = Math.min(range.e.r, lastRow);
    range.e.c = Math.min(range.e.c, lastColumn);
    range.s.r = Math.min(range.s.r, range.e.r);
    range.s.c = Math.min(range.s.c, range.e.c);
  }
  return { ...sheet, '!ref': XLSX.utils.encode_range(range) };
}
