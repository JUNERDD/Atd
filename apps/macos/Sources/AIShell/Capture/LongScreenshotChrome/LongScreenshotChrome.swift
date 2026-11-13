import AICore
import AppKit

/// The long screenshot's live chrome beside the selection, as the capture session hosts it on
/// the annotation host of the display holding most of the selection: the preview strip
/// (``LongScreenshotPreviewStrip``), the control bar (``LongScreenshotControlBar``) and its
/// status row (``LongScreenshotStatusRow``), built from the annotation toolbar's controls and
/// glass.
///
/// Placement (``LongScreenshotChromeLayout``): the strip beside the selection; the bar and the
/// row as one block placed like the annotation toolbar and its second row, clear of the bottom
/// bar, the size label and the strip, with the row's room the widest message's, so the bar never
/// moves as messages change. Nothing moves while the page scrolls. Dragging the bar or the row
/// moves both, kept inside the display; a double-click on either puts them back. The block is
/// placed again only then, or when a change of language changes the copy's room.
final class LongScreenshotChrome: LongScreenshotChromeHosting {
  var onAutoScroll: (() -> Void)? {
    get { bar.onAutoScroll }
    set { bar.onAutoScroll = newValue }
  }
  var onBack: (() -> Void)? {
    get { bar.onBack }
    set { bar.onBack = newValue }
  }
  var onDone: (() -> Void)? {
    get { bar.onDone }
    set { bar.onDone = newValue }
  }
  var onTail: (() -> Void)? {
    get { row.onTail }
    set { row.onTail = newValue }
  }

  private let strip = LongScreenshotPreviewStrip()
  private let bar = LongScreenshotControlBar()
  private let row = LongScreenshotStatusRow()
  private weak var host: NSView?
  private var selection = CGRect.zero
  private var keepClear = AnnotationToolbarLayout.KeepClear()
  /// Where a drag put the bar, until a double-click or another host; nil beside the selection.
  private var movedOrigin: CGPoint?
  private var dragOrigin = CGPoint.zero
  /// The language the copy was read in; another one is read again on the next update.
  private var language = ShellStrings.shared.language

  init() {
    let move: (AnnotationGlassBar.Drag) -> Void = { [weak self] drag in self?.moved(drag) }
    bar.onDrag = move
    row.onDrag = move
  }

  /// The strip's preview box in points (``LongScreenshotPreviewStrip/previewSize``), known once
  /// the chrome is shown: the session asks the engine for the stitched image scaled to fit it at
  /// the display's backing scale and passes that to ``update(_:message:preview:)``. It changes
  /// only when the chrome is shown again.
  var previewSize: CGSize { strip.previewSize }

  func show(in host: NSView, selection: CGRect, keepClear: AnnotationToolbarLayout.KeepClear) {
    if host !== self.host {
      if self.host != nil { movedOrigin = nil }
      for view in [strip, bar, row] as [NSView] { host.addSubview(view) }
      self.host = host
    }
    self.selection = selection
    self.keepClear = keepClear
    readStrings()
    place()
  }

  func update(
    _ progress: LongScreenshotProgress, message: LongScreenshotMessage?, preview: CGImage?
  ) {
    if ShellStrings.shared.language != language {
      readStrings()
      place()
    }
    bar.show(autoScrolling: progress.autoScrolling, screens: progress.screens)
    row.show(message)
    strip.show(progress, preview: preview)
  }

  func remove() {
    for view in [strip, bar, row] as [NSView] { view.removeFromSuperview() }
    strip.clear()
    host = nil
    movedOrigin = nil
  }

  /// The strip's, the bar's and, while it shows, the row's frames.
  var frames: [CGRect] {
    guard host != nil else { return [] }
    return [strip.frame, bar.frame] + (row.isHidden ? [] : [row.frame])
  }

  // MARK: Placement

  private func readStrings() {
    language = ShellStrings.shared.language
    bar.applyStrings()
    row.applyStrings()
    strip.applyStrings()
  }

  /// The strip beside the selection's part on the host's display and the block beside it or
  /// where it was dragged (``LongScreenshotChromeLayout``).
  private func place() {
    guard let host else { return }
    let display = host.bounds
    let part = selection.intersection(display)
    let area = part.isNull ? selection : part
    let stripFrame = LongScreenshotChromeLayout.strip(beside: area, within: display)
    strip.frame = stripFrame
    let toolbar = bar.fittingSize
    let frames =
      if let movedOrigin {
        AnnotationToolbarLayout.frames(
          toolbar: toolbar, styleBar: row.reservedSize, at: movedOrigin, within: display)
      } else {
        LongScreenshotChromeLayout.frames(
          toolbar: toolbar, styleBar: row.reservedSize, beside: area, within: display,
          keepClear: keepClear, strip: stripFrame)
      }
    bar.frame = frames.toolbar
    row.frame = CGRect(origin: frames.styleBar.origin, size: row.fittingSize)
  }

  /// The bar or the row dragged: both move as one block, led by the bar.
  private func moved(_ drag: AnnotationGlassBar.Drag) {
    switch drag {
    case .began: dragOrigin = bar.frame.origin
    case .moved(let travel):
      movedOrigin = CGPoint(x: dragOrigin.x + travel.dx, y: dragOrigin.y + travel.dy)
    case .reset: movedOrigin = nil
    }
    place()
  }
}
