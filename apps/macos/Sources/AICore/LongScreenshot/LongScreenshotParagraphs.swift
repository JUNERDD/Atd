import CoreGraphics
import Foundation

// A long screenshot's recognized text as paragraphs, for its full-screen preview's picks and text
// commands (the plan's 「长截图的全屏预览」): the recognized lines grouped as the capture editor
// groups a screenshot's (``CaptureTextLayout``), in image points with the origin at the top-left,
// and the rule for which paragraphs the kept range lets a command read.

extension LongScreenshotCardSource {
  /// The recognized lines grouped into paragraphs in reading order, over the whole image (image
  /// points). A paragraph's index stays valid for the lightbox's life: the source never changes.
  public var paragraphs: CaptureTextLayout {
    CaptureTextLayout(lines: lines.map { ScreenContext.TextBox(text: $0.text, box: $0.box) })
  }
}

extension LongScreenshotKept {
  /// The paragraphs of `layout` that can be picked, copied and read by a command, in reading
  /// order: those whose every line the range keeps (``keeps(_:)``, as the card keeps lines,
  /// ``LongScreenshotCardState/keptLines``), less those any mosaic on the image touches
  /// (``redactedAreas``, ``CaptureTextLayout/available(hiding:)``; decision D6). A paragraph a
  /// handle cuts through is left out whole, so no line trimmed off goes out as text; moving the
  /// handle or the mosaic away brings it back.
  public func available(in layout: CaptureTextLayout) -> [Int] {
    layout.available(hiding: redactedAreas).filter { index in
      layout[index].lines.allSatisfy { keeps($0.box) }
    }
  }
}
