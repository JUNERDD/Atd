import { describe, expect, it } from 'vitest';
import { opensWithoutAsking, safeFileName } from './artifact-open-policy';

describe('artifact open policy', () => {
  it('opens document, media and office types without asking, in any case', () => {
    for (const name of [
      'report.pdf',
      'NOTES.MD',
      'data.Csv',
      'photo.jpeg',
      'clip.mov',
      'song.m4a',
      'deck.pptx',
      'budget.numbers',
      'id-.pdf',
    ])
      expect(opensWithoutAsking(name), name).toBe(true);
  });

  it('asks for types that can run code when opened on macOS', () => {
    for (const name of [
      'run.command',
      'shell.terminal',
      'tool.jar',
      'link.fileloc',
      'site.webloc',
      'share.inetloc',
      'flow.workflow',
      'script.scpt',
      'script.applescript',
      'setup.pkg',
      'setup.mpkg',
      'image.dmg',
      'Tool.app',
      'do.shortcut',
      'page.html',
      'vector.svg',
      'macro.docm',
    ])
      expect(opensWithoutAsking(name), name).toBe(false);
  });

  it('judges only the final extension', () => {
    expect(opensWithoutAsking('invoice.pdf.command')).toBe(false);
    expect(opensWithoutAsking('invoice.PDF.Command')).toBe(false);
    expect(opensWithoutAsking('archive.command.pdf')).toBe(true);
  });

  it('asks when there is no usable extension', () => {
    for (const name of ['README', '.pdf', 'trailing.pdf.', 'spaced.pdf ', ''])
      expect(opensWithoutAsking(name), name).toBe(false);
  });

  it('classifies the sanitized name, where direction overrides cannot disguise the type', () => {
    // U+202E renders "invoice‮fdp.command" as "invoicednammoc.pdf".
    const name = safeFileName('invoice‮fdp.command');
    expect(name).toBe('invoicefdp.command');
    expect(opensWithoutAsking(name)).toBe(false);
  });

  it('keeps path separators, reserved and control characters out of the file name', () => {
    expect(safeFileName('../a/b\\c:d\n.txt')).toBe('.._a_b_c_d_.txt');
    expect(safeFileName('')).toBe('download.bin');
  });
});
