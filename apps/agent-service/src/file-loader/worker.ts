import { parentPort } from 'node:worker_threads';
import { OutputWriteError } from './output-write.js';
import {
  failureReason,
  parseJob,
  type ExtractOutcome,
  type PdfPagesReply,
  type WorkerJob,
} from './jobs.js';

/**
 * Entry of one extraction worker (extract.ts): it receives one job, answers once and is then
 * terminated. Each extractor is imported only for its job, so a worker loads one parser.
 */
async function extract(job: WorkerJob): Promise<ExtractOutcome | PdfPagesReply> {
  switch (job.kind) {
    case 'pdf-pages':
      return (await import('./pdf-text.js')).pdfPages(job.bytes, job);
    case 'docx':
      return (await import('./docx.js')).docxDocument(job.bytes, job.label, job.out);
    case 'sheet':
      return (await import('./sheets.js')).sheetDocument(job.bytes, job.label, job.zipped, job.out);
    case 'pptx':
      return (await import('./pptx.js')).pptxDocument(job.bytes, job.label, job.out);
    case 'odp':
      return (await import('./odp.js')).odpDocument(job.bytes, job.label);
    case 'epub':
      return (await import('./epub.js')).epubDocument(job.bytes, job.label);
    case 'html':
      return (await import('./markdown.js')).htmlDocument(job.html, job.label, job.included);
    case 'flat': {
      const { flatDocument } = await import('./document.js');
      return flatDocument(job.text, job.label, job.included, job.warnings);
    }
  }
}

const port = parentPort;
if (!port) throw new Error('The file loader worker runs only as a worker thread.');
port.once('message', (message: unknown) => {
  void (async () => {
    let reply: ExtractOutcome | PdfPagesReply;
    try {
      reply = await extract(parseJob(message));
    } catch (error) {
      reply = {
        status: 'failed',
        reason: failureReason(error),
        ...(error instanceof OutputWriteError ? { outputFailed: true } : {}),
      };
    }
    port.postMessage(reply);
  })();
});
