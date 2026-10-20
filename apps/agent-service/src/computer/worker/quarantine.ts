import { execFile } from 'node:child_process';

/**
 * The macOS download metadata Chrome gives a file it saves itself, applied to a file the worker
 * saved. Chrome writes a download through Playwright into the staging directory with only a reduced
 * quarantine (no source, no event), and Playwright's `saveAs` copies the bytes without extended
 * attributes, so the saved file would carry none. Chrome's own path (Chromium's
 * `quarantine_mac.mm`) sets `NSURLQuarantinePropertiesKey` (type web download, the download URL as
 * data URL, the page as origin URL), which also records a Launch Services quarantine event, and
 * writes `kMDItemWhereFroms` as [download URL, page URL]. The worker does the same through the same
 * Foundation API, in one `osascript` (JavaScript for Automation) call per download, and names
 * Chrome as the quarantine agent, which Launch Services would otherwise fill with the calling
 * process. Only http(s) URLs are recorded, as Chrome records no `data:` or `blob:` source.
 */

const OSASCRIPT = '/usr/bin/osascript';
const TIMEOUT_MS = 10_000;

/** Arguments: file, download URL (may be empty), page URL (may be empty). */
const SCRIPT = `ObjC.import('Foundation');
ObjC.bindFunction('setxattr', ['int', ['char *', 'char *', 'void *', 'unsigned long', 'unsigned int', 'int']]);
ObjC.bindFunction('getxattr', ['long', ['char *', 'char *', 'void *', 'unsigned long', 'unsigned int', 'int']]);
function run(argv) {
  const [file, source, origin] = argv;
  const props = $.NSMutableDictionary.dictionary;
  props.setObjectForKey($('LSQuarantineTypeWebDownload'), $('LSQuarantineType'));
  props.setObjectForKey($('Chrome'), $('LSQuarantineAgentName'));
  props.setObjectForKey($('com.google.Chrome'), $('LSQuarantineAgentBundleIdentifier'));
  if (source) props.setObjectForKey($.NSURL.URLWithString(source), $('LSQuarantineDataURL'));
  if (origin) props.setObjectForKey($.NSURL.URLWithString(origin), $('LSQuarantineOriginURL'));
  if (!$.NSURL.fileURLWithPath(file).setResourceValueForKeyError(props, $.NSURLQuarantinePropertiesKey, null))
    throw new Error('quarantine');
  const buffer = $.NSMutableData.dataWithLength(1024);
  const size = $.getxattr(file, 'com.apple.quarantine', buffer.mutableBytes, 1024, 0, 0);
  if (size <= 0) throw new Error('quarantine missing');
  const fields = $.NSString.alloc.initWithDataEncoding(buffer.subdataWithRange($.NSMakeRange(0, size)), $.NSUTF8StringEncoding).js.split(';');
  if (fields.length >= 4 && fields[2] === '') {
    fields[2] = 'Chrome';
    const value = $(fields.join(';')).dataUsingEncoding($.NSUTF8StringEncoding);
    if ($.setxattr(file, 'com.apple.quarantine', value.bytes, value.length, 0, 0) !== 0) throw new Error('agent');
  }
  const froms = $.NSMutableArray.array;
  if (source) froms.addObject($(source));
  if (origin) froms.addObject($(origin));
  if (froms.count > 0) {
    const data = $.NSPropertyListSerialization.dataWithPropertyListFormatOptionsError(froms, $.NSPropertyListBinaryFormat_v1_0, 0, null);
    if ($.setxattr(file, 'com.apple.metadata:kMDItemWhereFroms', data.bytes, data.length, 0, 0) !== 0)
      throw new Error('whereFroms');
  }
  return 'ok';
}`;

/** `url` when it is an http(s) URL Chrome would record, else empty. */
function recorded(url: string): string {
  try {
    const { protocol } = new URL(url);
    return protocol === 'http:' || protocol === 'https:' ? url : '';
  } catch {
    return '';
  }
}

/**
 * Marks `file` as downloaded by Chrome from `source` on the page `origin`. Rejects when macOS
 * did not take the quarantine, so the caller can discard a file it could not mark.
 */
export function markDownloaded(file: string, source: string, origin: string): Promise<void> {
  if (process.platform !== 'darwin') return Promise.resolve();
  const args = ['-l', 'JavaScript', '-e', SCRIPT, file, recorded(source), recorded(origin)];
  return new Promise((resolve, reject) => {
    execFile(OSASCRIPT, args, { timeout: TIMEOUT_MS }, (error, stdout) => {
      if (error !== null || stdout.trim() !== 'ok')
        reject(new Error('The download could not be marked as quarantined.'));
      else resolve();
    });
  });
}
