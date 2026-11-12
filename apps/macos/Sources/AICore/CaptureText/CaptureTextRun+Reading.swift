import Foundation

// MARK: What one run reads

extension CaptureTextRun {
  /// The most paragraphs one run reads (contract: `captureText.run`).
  public static let maxParagraphs = 4000
  /// The most UTF-16 units the selection the page builds from a run's paragraphs may take
  /// (contract C2: `@@<id>` over each paragraph's text, a blank line between).
  public static let maxSelectionLength = 100_000

  /// The id a run gives the paragraph at `position` (from 0) of those it reads.
  public static func paragraphID(_ position: Int) -> String { "p\(position + 1)" }

  /// How many of `texts` (the paragraphs' texts, in the order a run reads them), from the first,
  /// one run reads: no more than ``maxParagraphs``, and no more than keep the selection the page
  /// builds from them within ``maxSelectionLength``. The rest is left out in order, so what comes
  /// first (the full-screen preview's paragraphs in view) stays.
  public static func capacity(of texts: some Sequence<String>) -> Int {
    fitting(texts.enumerated().lazy.map { (paragraphID($0.offset), $0.element) })
  }

  /// How many of `blocks` (each paragraph's id in the run and its text, in reading order), from
  /// the first, one run's selection holds (``capacity(of:)``).
  static func fitting(_ blocks: some Sequence<(id: String, text: String)>) -> Int {
    var count = 0
    var length = 0
    for block in blocks {
      guard count < maxParagraphs else { break }
      let size = 2 + block.id.utf16.count + 1 + block.text.utf16.count
      let next = length + (count == 0 ? 0 : 2) + size
      guard next <= maxSelectionLength else { break }
      length = next
      count += 1
    }
    return count
  }

  /// What the run reads now, for a retry's `captureText.action` (`reading`), with `files`, the
  /// screenshot as it shows now and its context.
  public func reading(files: [FileRef]) -> CaptureTextActionEvent.Reading {
    CaptureTextActionEvent.Reading(
      scope: scope.kind == .picked ? .picked : .all,
      paragraphs: paragraphs.map { .init(id: $0.id, text: $0.paragraph.text) }, files: files)
  }
}

extension CaptureTextParagraph {
  /// The paragraph as runs compare what they read: its box and text, which tell the paragraphs
  /// of one image's layout apart.
  var readingKey: String {
    "\(box.minX),\(box.minY),\(box.width),\(box.height)|\(text)"
  }
}
