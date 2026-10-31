// Recognizes the text of a PDF's pages or of an image on this Mac, with the on-device Vision
// framework and nothing to install. Prints one `--- Page N (OCR) ---` section per PDF page, or the
// image's text. Languages are detected automatically.
//
//   osascript -l JavaScript ocr.js <file> [first page] [last page]
//
// Images are any format macOS reads (PNG, JPEG, HEIC, TIFF, GIF, BMP, WebP). Pages render at up
// to 2400 pixels on their long side, which keeps small print legible.
ObjC.import('Vision');
ObjC.import('PDFKit');
ObjC.import('AppKit');

function recognize(handler) {
  const request = $.VNRecognizeTextRequest.alloc.init;
  request.recognitionLevel = $.VNRequestTextRecognitionLevelAccurate;
  request.usesLanguageCorrection = true;
  request.automaticallyDetectsLanguage = true;
  if (!handler.performRequestsError($([request]), $())) return null;
  const lines = [];
  const results = request.results;
  for (let i = 0; i < results.count; i++) {
    const best = results.objectAtIndex(i).topCandidates(1).firstObject;
    if (best && !best.isNil()) lines.push(best.string.js);
  }
  return lines.join('\n');
}

function pageText(page) {
  const box = page.boundsForBox($.kPDFDisplayBoxMediaBox);
  const scale = Math.min(3, 2400 / Math.max(box.size.width, box.size.height, 1));
  const size = $.NSMakeSize(box.size.width * scale, box.size.height * scale);
  const image = page.thumbnailOfSizeForBox(size, $.kPDFDisplayBoxMediaBox);
  const bitmap = $.NSBitmapImageRep.imageRepWithData(image.TIFFRepresentation);
  return recognize($.VNImageRequestHandler.alloc.initWithCGImageOptions(bitmap.CGImage, $()));
}

/** Whether the file starts like a PDF; asking PDFKit about an image logs a CoreGraphics error. */
function isPdf(path) {
  const handle = $.NSFileHandle.fileHandleForReadingAtPath(path);
  if (handle.isNil()) throw new Error('The file cannot be opened.');
  const head = $.NSString.alloc.initWithDataEncoding(
    handle.readDataOfLength(5),
    $.NSASCIIStringEncoding,
  );
  handle.closeFile;
  return !head.isNil() && head.js === '%PDF-';
}

function run(argv) {
  const [path, firstArg, lastArg] = argv;
  if (!path) throw new Error('Usage: ocr.js <file> [first page] [last page]');
  const url = $.NSURL.fileURLWithPath(path);
  if (!isPdf(path)) {
    const text = recognize($.VNImageRequestHandler.alloc.initWithURLOptions(url, $()));
    if (text === null) throw new Error('Not a PDF or an image macOS can read.');
    return text || '[No text recognized]';
  }
  const doc = $.PDFDocument.alloc.initWithURL(url);
  if (doc.isNil()) throw new Error('The PDF cannot be opened.');
  if (doc.isLocked) throw new Error('The PDF is locked with a password.');
  const count = doc.pageCount;
  const first = Math.max(1, Number(firstArg) || 1);
  const last = Math.min(count, Number(lastArg) || count);
  const sections = [];
  for (let n = first; n <= last; n++) {
    const text = pageText(doc.pageAtIndex(n - 1));
    const body = text === null ? '[Recognition failed]' : text || '[No text recognized]';
    sections.push(`--- Page ${n} (OCR) ---\n${body}`);
  }
  return sections.join('\n\n');
}
