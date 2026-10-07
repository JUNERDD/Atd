import AICore
import AppKit
import WebKit

/// The renderer's web view. It moves its window from the drag regions its page reports
/// (``WindowDraggingWebView``) and adds the two things WebKit cannot do for this app:
/// - **File drops.** Dropped file and folder URLs go to the shell, which imports files by path
///   and registers folders; WebKit would otherwise hand the page `File` objects the relay cannot
///   upload (spike S1). The page gets no drag events for them, so the shell reports the drag
///   (`onFileDrag`) instead.
/// - **Pasted files and bitmaps.** Edit › Paste runs ``pasteAttachingFiles(_:)``: file URLs on
///   the pasteboard are imported, and so is a bitmap when no text came with it; anything else
///   pastes into the page as usual.
///
/// It also keeps the last left press, which a desktop pin drag the page asks for starts from
/// (``DesktopPinDrag``), and ends that press for WebKit once the drag is over.
final class ShellWebView: WindowDraggingWebView {
  /// The latest left mouse-down in this view.
  private(set) var lastMouseDown: NSEvent?
  /// Receives dropped (`drop`) or pasted (`paste`) file URLs; nil leaves both to WebKit.
  var onFiles: ((_ files: [URL], _ source: String) -> Void)?
  /// Receives a file drag entering (its summary) and leaving, dropped or not (nil); only a view
  /// with `onFiles` takes file drags.
  var onFileDrag: ((FileDragSummary?) -> Void)?
  /// Receives the encoded bitmap (PNG, TIFF or JPEG data) of a paste that carries no file URLs
  /// and no text; nil leaves such a paste to WebKit, which would insert it into the editor.
  var onPastedImage: ((_ data: Data) -> Void)?

  /// Records every press, then lets a drag region move the window or WebKit take it.
  override func mouseDown(with event: NSEvent) {
    lastMouseDown = event
    super.mouseDown(with: event)
  }

  /// Ends the press a drag the shell ran from took over (``DesktopPinDrag``): WebKit never gets
  /// that drag's release, and would otherwise treat the mouse as held, turning hover into a
  /// selection drag. The release lands far outside the page, so it clicks nothing there.
  func releasePress() {
    guard let window, let press = lastMouseDown else { return }
    lastMouseDown = nil
    guard
      let release = NSEvent.mouseEvent(
        with: .leftMouseUp, location: NSPoint(x: -100_000, y: -100_000), modifierFlags: [],
        timestamp: ProcessInfo.processInfo.systemUptime, windowNumber: window.windowNumber,
        context: nil, eventNumber: press.eventNumber, clickCount: press.clickCount, pressure: 0)
    else { return }
    mouseUp(with: release)
  }

  // MARK: File drops

  private func droppedFiles(_ info: any NSDraggingInfo) -> [URL] {
    let options: [NSPasteboard.ReadingOptionKey: Any] = [.urlReadingFileURLsOnly: true]
    return info.draggingPasteboard.readObjects(forClasses: [NSURL.self], options: options)
      as? [URL] ?? []
  }

  /// The file drag over the view, read when it entered; nil for any other drag, which WebKit
  /// handles. A drag with nothing attachable is refused, so the cursor says so before the drop.
  private var fileDrag: FileDragSummary? {
    didSet { if fileDrag != oldValue { onFileDrag?(fileDrag) } }
  }

  private var fileDragOperation: NSDragOperation {
    (fileDrag?.attachable ?? 0) > 0 ? .copy : []
  }

  override func draggingEntered(_ sender: any NSDraggingInfo) -> NSDragOperation {
    let files = droppedFiles(sender)
    guard onFiles != nil, !files.isEmpty else { return super.draggingEntered(sender) }
    fileDrag = FileDragSummary(items: files.map(ImportItem.init(fileURL:)))
    return fileDragOperation
  }

  override func draggingUpdated(_ sender: any NSDraggingInfo) -> NSDragOperation {
    guard fileDrag != nil else { return super.draggingUpdated(sender) }
    return fileDragOperation
  }

  /// Sent when the drag leaves, is cancelled, or is released while refused.
  override func draggingExited(_ sender: (any NSDraggingInfo)?) {
    guard fileDrag != nil else { return super.draggingExited(sender) }
    fileDrag = nil
  }

  override func prepareForDragOperation(_ sender: any NSDraggingInfo) -> Bool {
    guard fileDrag != nil else { return super.prepareForDragOperation(sender) }
    if fileDragOperation.isEmpty { fileDrag = nil }
    return !fileDragOperation.isEmpty
  }

  /// The import starts before the drag is cleared, so the page goes from `over` to `importing`.
  override func performDragOperation(_ sender: any NSDraggingInfo) -> Bool {
    let files = droppedFiles(sender)
    guard fileDrag != nil, let onFiles, !files.isEmpty else {
      return super.performDragOperation(sender)
    }
    onFiles(files, "drop")
    fileDrag = nil
    return true
  }

  // MARK: Paste

  /// The Edit › Paste action. WebKit's own `paste:` is not visible to Swift, so it is reached
  /// through the responder chain instead of `super`. ``PasteboardPaste`` decides; a window
  /// without the matching callback always pastes through WebKit.
  @objc func pasteAttachingFiles(_ sender: Any?) {
    let board = NSPasteboard.general
    let options: [NSPasteboard.ReadingOptionKey: Any] = [.urlReadingFileURLsOnly: true]
    let files = board.readObjects(forClasses: [NSURL.self], options: options) as? [URL] ?? []
    let image = onPastedImage == nil ? nil : Self.imageData(on: board)
    let route = PasteboardPaste.route(
      hasFileURLs: onFiles != nil && !files.isEmpty,
      hasText: board.string(forType: .string)?.isEmpty == false, hasImage: image != nil)
    switch route {
    case .files: onFiles?(files, "paste")
    case .image: if let image { onPastedImage?(image) }
    case .webKit: NSApp.sendAction(#selector(NSText.paste(_:)), to: self, from: sender)
    }
  }

  /// The pasteboard's bitmap in the first format ImageIO decodes that it offers: a screenshot
  /// copy is PNG, most apps copy TIFF.
  private static func imageData(on board: NSPasteboard) -> Data? {
    [NSPasteboard.PasteboardType.png, .tiff, NSPasteboard.PasteboardType("public.jpeg")]
      .lazy.compactMap { board.data(forType: $0) }.first
  }
}
