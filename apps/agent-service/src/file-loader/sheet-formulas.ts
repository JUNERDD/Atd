import * as XLSX from 'xlsx';
import { counted } from './document.js';

/** Preserve formulas whose cached value is absent, without guessing whether a cached zero is real. */
export function flagSheetFormulas(book: XLSX.WorkBook): string[] {
  let missing = 0;
  const first: string[] = [];
  for (const name of book.SheetNames) {
    const data = book.Sheets[name]?.['!data'];
    if (!data) continue;
    for (let r = 0; r < data.length; r += 1) {
      const row = data[r];
      if (!row) continue;
      for (let c = 0; c < row.length; c += 1) {
        const cell = row[c];
        if (!cell || cell.f === undefined || (cell.t !== 'z' && cell.v !== undefined)) continue;
        cell.t = 's';
        cell.v = `=${cell.f}`;
        delete cell.w;
        missing += 1;
        if (first.length < 5)
          first.push(
            `'${name.replace(/\s+/g, ' ').replace(/'/g, "''")}'!${XLSX.utils.encode_cell({ r, c })}`,
          );
      }
    }
  }
  const warnings = missing
    ? [
        `${counted(missing, 'formula cell')} without cached results shown as formulas: ${first.join(', ')}${missing > first.length ? ', …' : ''}.`,
      ]
    : [];
  // SheetJS parses CalcPr but its declarations omit it; narrow the external metadata here.
  const metadata = book.Workbook;
  const calc: unknown = metadata && 'CalcPr' in metadata ? metadata.CalcPr : undefined;
  const full =
    calc && typeof calc === 'object' && 'fullCalcOnLoad' in calc ? calc.fullCalcOnLoad : undefined;
  if (full === '1' || full === 1 || full === true || full === 'true')
    warnings.push(
      'This workbook requests recalculation when opened; cached formula results may be stale. Formulas have not been recalculated.',
    );
  return warnings;
}
