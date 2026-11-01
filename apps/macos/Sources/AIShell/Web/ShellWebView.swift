import AICore
import AppKit
import WebKit

/// What a drop from another app brings without file URLs that the panel takes, read as the mini
/// panel reads it (``MiniPanelDropPayload``).
enum DroppedContent {
  /// Promised files, with the drop's pasteboard, which may also hold the drop's image.
  case promises([NSFilePromiseReceiver], NSPasteboard)
  /// A bitmap without a file: PNG, TIFF or JPEG data.
  case image(Data)
}

/// The renderer's web view. It moves its window from the drag regions its page reports
/// (``WindowDraggingWebView``) and adds the two things WebKit cannot do for this app:
/// - **File drops.** Dropped file and folder URLs go to the shell, which imports files by path
///   and registers folders; WebKit would otherwise hand the page `File` objects the relay cannot
///   upload (spike S1). So does what a drop from another app brings as files without their URLs
///   (``DroppedContent``): promised files (Photos, Mail, a browser's images), or else a bitmap a
///   paste would also attach (``PasteboardPaste``); text and links still drop into the page. The
///   page gets no drag events for what the shell takes, so the shell reports the drag
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
  /// Receives what a drop from another app brings without file URLs; nil leaves such drops to
  /// WebKit. Only a view with `onFiles` takes drops.
  var onDroppedContent: ((DroppedContent) -> Void)?
  /// Receives a file drag entering (its summary) and leaving, dropped or not (nil); only a view
  /// with `onFiles` takes file drags.
  var onFileDrag: ((FileDragSummary?) -> Void)?
  /// Receives the encoded bitmap (PNG, TIFF or JPEG data) of a paste that carries no file URLs
  /// and no text; nil leaves such a paste to WebKit, which would insert it into the editor.
  var onPastedImage: ((_ data: Data) -> Void)?

  /// Records every press, then lets a drag region move the window or WebKit take it.
  override func mouseDown(with event: NSEvent) {
    FocusDiagnostics.shared.mouse(event, stage: "webview.mouseDown")
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

  /// What the shell takes from a drag instead of WebKit, as the page hears of it: file and folder
  /// URLs from anywhere; from another app, promised files, or else a bitmap without text. Nil for
  /// any other drag, Atd's own included (an image dragged within the page).
  private func takenDrag(_ info: any NSDraggingInfo) -> FileDragSummary? {
    let files = droppedFiles(info)
    if !files.isEmpty { return FileDragSummary(items: files.map(ImportItem.init(fileURL:))) }
    guard onDroppedContent != nil, info.draggingSource == nil else { return nil }
    let board = info.draggingPasteboard
    let offer = MiniPanelDragOffer(types: board.types ?? [])
    let promised = offer.promises ? MiniPanelDropPayload.promises(on: board) : []
    if !promised.isEmpty { return FileDragSummary(arriving: MiniPanelPromises.expected(promised)) }
    let paste = PasteboardPaste.route(
      hasFileURLs: false, hasText: offer.text, hasImage: offer.image)
    return paste == .image ? FileDragSummary(arriving: 1) : nil
  }

  /// A drop's promised files, or else its bitmap.
  private static func droppedContent(on board: NSPasteboard) -> DroppedContent? {
    let promised = MiniPanelDropPayload.promises(on: board)
    if !promised.isEmpty { return .promises(promised, board) }
    return MiniPanelDropPayload.image(on: board).map(DroppedContent.image)
  }

  /// The file drag over the view, read when it entered; nil for any other drag, which WebKit
  /// handles. Every file drag is accepted: its import takes any file and any folder, so the
  /// summary tells the page how much of it a drop attaches, never that it attaches nothing.
  private var fileDrag: FileDragSummary? {
    didSet { if fileDrag != oldValue { onFileDrag?(fileDrag) } }
  }

  override func draggingEntered(_ sender: any NSDraggingInfo) -> NSDragOperation {
    guard onFiles != nil, let summary = takenDrag(sender) else {
      return super.draggingEntered(sender)
    }
    fileDrag = summary
    return .copy
  }

  override func draggingUpdated(_ sender: any NSDraggingInfo) -> NSDragOperation {
    guard fileDrag != nil else { return super.draggingUpdated(sender) }
    return .copy
  }

  /// Sent when the drag leaves or is cancelled.
  override func draggingExited(_ sender: (any NSDraggingInfo)?) {
    guard fileDrag != nil else { return super.draggingExited(sender) }
    fileDrag = nil
  }

  override func prepareForDragOperation(_ sender: any NSDraggingInfo) -> Bool {
    guard fileDrag != nil else { return super.prepareForDragOperation(sender) }
    return true
  }

  /// The import starts before the drag is cleared, so the page goes from `over` to `importing`.
  override func performDragOperation(_ sender: any NSDraggingInfo) -> Bool {
    guard fileDrag != nil else { return super.performDragOperation(sender) }
    defer { fileDrag = nil }
    let files = droppedFiles(sender)
    if !files.isEmpty {
      onFiles?(files, "drop")
    } else if let content = Self.droppedContent(on: sender.draggingPasteboard) {
      onDroppedContent?(content)
    } else {
      return false
    }
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
    let image = onPastedImage == nil ? nil : MiniPanelDropPayload.image(on: board)
    let route = PasteboardPaste.route(
      hasFileURLs: onFiles != nil && !files.isEmpty,
      hasText: board.string(forType: .string)?.isEmpty == false, hasImage: image != nil)
    switch route {
    case .files: onFiles?(files, "paste")
    case .image: if let image { onPastedImage?(image) }
    case .webKit: NSApp.sendAction(#selector(NSText.paste(_:)), to: self, from: sender)
    }
  }
}
