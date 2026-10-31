import { listZip, ZIP_LIMITS } from './zip.js';

const MB = 1_000_000;
const PREVIEW_MIB = 900;
const WHOLE_MIB = 820;
const OTHER_WHOLE_BYTES = 16 * 1024 * 1024;

export interface SheetBudget {
  whole: boolean;
  /** OOXML's row-limited parser also narrows the range to the cells it encountered. */
  narrowPreview: boolean;
}

/**
 * Predicts SheetJS's heap plus external memory before any inflation. The OOXML fit uses decimal
 * MB of worksheet and shared-string parts, predicting MiB. Other formats have a smaller measured
 * size allowance: binary cells and ODS repeated rows do not follow the XML cell-density model.
 */
export function sheetBudget(bytes: Uint8Array, zipped: boolean): SheetBudget {
  if (!zipped) return otherBudget(bytes.byteLength);
  const listing = listZip(bytes);
  if (!listing) throw new Error('its workbook archive is malformed');
  if (listing.more)
    throw new Error(
      `the archive has more than ${ZIP_LIMITS.entries.toLocaleString('en-US')} entries`,
    );
  let sheets = 0;
  let strings = 0;
  let other = 0;
  let xml = false;
  let binary = false;
  for (const part of listing.entries) {
    if (/^xl\/worksheets\/[^/]+\.xml$/.test(part.name)) {
      sheets += part.size;
      xml = true;
    } else if (/^xl\/worksheets\/[^/]+\.bin$/.test(part.name)) {
      sheets += part.size;
      binary = true;
    } else if (/^xl\/sharedStrings\.(?:xml|bin)$/.test(part.name)) strings += part.size;
    else if (part.name === 'content.xml' || /^Index\/.*\.iwa$/.test(part.name)) other += part.size;
  }
  if (!xml || binary) return otherBudget(sheets + strings + other, binary);
  const s = sheets / MB;
  const t = strings / MB;
  refuseLargePreview(64 + 3.13 * s + 7.21 * t);
  return { whole: 110 + 6.2 * s + 4.3 * t <= WHOLE_MIB, narrowPreview: true };
}

function otherBudget(size: number, narrowPreview = false): SheetBudget {
  // Small XLS/ODS/XLSB fixtures leave substantial headroom at this conservative amplification.
  refuseLargePreview(64 + (40 * size) / MB);
  return { whole: size <= OTHER_WHOLE_BYTES, narrowPreview };
}

function refuseLargePreview(predicted: number): void {
  if (predicted > PREVIEW_MIB)
    throw new Error(
      `its workbook preview is estimated to need ${Math.ceil(predicted).toLocaleString('en-US')} MiB of memory, above the ${PREVIEW_MIB} MiB safety limit`,
    );
}
