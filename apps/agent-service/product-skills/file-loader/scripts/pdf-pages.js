// Renders a PDF's pages to PNG files on this Mac (PDFKit, nothing to install), for looking at
// what text extraction cannot show: charts, forms, stamps, signatures, handwriting, layout.
// Prints the path of every image it wrote.
//
//   osascript -l JavaScript pdf-pages.js <pdf> <output folder> [first page] [last page]
//
// Pages render at up to 1600 pixels on their long side, about what a model sees of an image.
ObjC.import('PDFKit');
ObjC.import('AppKit');

function run(argv) {
  const [path, outDir, firstArg, lastArg] = argv;
  if (!path || !outDir) throw new Error('Usage: pdf-pages.js <pdf> <output folder> [first] [last]');
  const doc = $.PDFDocument.alloc.initWithURL($.NSURL.fileURLWithPath(path));
  if (doc.isNil()) throw new Error('Not a PDF macOS can read.');
  if (doc.isLocked) throw new Error('The PDF is locked with a password.');
  const files = $.NSFileManager.defaultManager;
  files.createDirectoryAtPathWithIntermediateDirectoriesAttributesError(outDir, true, $(), $());
  const count = doc.pageCount;
  const first = Math.max(1, Number(firstArg) || 1);
  const last = Math.min(count, Number(lastArg) || count);
  const written = [];
  for (let n = first; n <= last; n++) {
    const page = doc.pageAtIndex(n - 1);
    const box = page.boundsForBox($.kPDFDisplayBoxMediaBox);
    const scale = Math.min(2, 1600 / Math.max(box.size.width, box.size.height, 1));
    const size = $.NSMakeSize(box.size.width * scale, box.size.height * scale);
    const image = page.thumbnailOfSizeForBox(size, $.kPDFDisplayBoxMediaBox);
    const bitmap = $.NSBitmapImageRep.imageRepWithData(image.TIFFRepresentation);
    const png = bitmap.representationUsingTypeProperties($.NSBitmapImageFileTypePNG, $());
    const out = `${outDir}/page-${n}.png`;
    if (!png.writeToFileAtomically(out, true)) throw new Error(`Could not write ${out}`);
    written.push(out);
  }
  return `Pages ${first}-${last} of ${count}:\n${written.join('\n')}`;
}
