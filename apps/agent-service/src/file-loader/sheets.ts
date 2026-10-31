import * as XLSX from 'xlsx';
import * as cptable from 'xlsx/dist/cpexcel.full.mjs';
import { counted, documentText } from './document.js';
import type { ExtractOutcome } from './jobs.js';
import { storedCopy } from './zip.js';

// Legacy .xls files store text in Windows code pages (GBK, Shift_JIS, …); SheetJS decodes them
// only with these tables.
XLSX.set_cptable(cptable);

/** Data rows read per sheet, after its header row; the sheet's section says where it was cut. */
const MAX_ROWS = 10_000;
/** Sheets read per workbook. */
const MAX_SHEETS = 50;

/**
 * A workbook's sheets as CSV through SheetJS: each under `## Sheet: <name> (<rows> rows × <cols>
 * columns)`, sized by its full range, hidden rows and columns and blank rows left out. Cells show
 * their formatted values; formulas their last saved results.
 */
export function sheetDocument(bytes: Uint8Array, label: string, zipped: boolean): ExtractOutcome {
  let book: XLSX.WorkBook;
  try {
    book = XLSX.read(zipped ? storedCopy(bytes) : bytes, {
      type: 'array',
      dense: true,
      // A sheet cut here keeps its whole range in `!fullref`.
      sheetRows: MAX_ROWS + 1,
      cellDates: true,
      cellHTML: false,
      cellStyles: false,
      cellFormula: false,
      bookVBA: false,
    });
  } catch (error) {
    if (error instanceof Error && /password/i.test(error.message)) return { status: 'protected' };
    throw error;
  }
  const names = book.SheetNames;
  const sections = names.slice(0, MAX_SHEETS).map((name) => sheetSection(name, book.Sheets[name]));
  const warnings =
    names.length > MAX_SHEETS
      ? [`Only the first ${MAX_SHEETS} of ${names.length} sheets are included.`]
      : [];
  return {
    status: 'text',
    text: documentText({
      label,
      facts: [counted(names.length, 'sheet')],
      included: 'cell values as CSV; formulas show their last saved results',
      warnings,
      body: sections.join('\n\n'),
    }),
  };
}

function sheetSection(name: string, sheet: XLSX.WorkSheet | undefined): string {
  const read = sheet?.['!ref'];
  const fullRef: unknown = sheet?.['!fullref'];
  const full = typeof fullRef === 'string' ? fullRef : read;
  const size = full ? XLSX.utils.decode_range(full) : undefined;
  const rows = size ? size.e.r - size.s.r + 1 : 0;
  const columns = size ? size.e.c - size.s.c + 1 : 0;
  const title = name.replace(/\s+/g, ' ');
  const lines = [`## Sheet: ${title} (${counted(rows, 'row')} × ${counted(columns, 'column')})`];
  if (!sheet || !read) return lines.join('\n');
  const csv = XLSX.utils
    .sheet_to_csv(sheet, { blankrows: false, skipHidden: true, strip: true })
    .trimEnd();
  if (csv) lines.push(csv);
  if (full !== read) {
    const kept = XLSX.utils.decode_range(read);
    const last = kept.e.r - kept.s.r + 1;
    lines.push(
      `[Sheet cut after row ${last.toLocaleString('en-US')} of ${rows.toLocaleString('en-US')}]`,
    );
  }
  return lines.join('\n');
}
