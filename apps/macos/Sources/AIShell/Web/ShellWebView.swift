import AICore
import AppKit
import WebKit

/// The renderer's web view with the three things WebKit cannot do for this app:
/// - **Window drag (plan decision R9, zone C).** WKWebView ignores `-webkit-app-region`, so the
///   page pushes its drag rectangles and a mouse-down inside one starts a native window drag
///   synchronously, while the event is still current. A double-click runs the system's title
///   bar action.
/// - **File drops.** Dropped file URLs go to the shell, which imports them by path; WebKit
///   would otherwise hand the page `File` objects the relay cannot upload (spike S1).
/// - **Pasted files and bitmaps.** Edit › Paste runs ``pasteAttachingFiles(_:)``: file URLs on
///   the pasteboard are imported, and so is a bitmap when no text came with it; anything else
///   pastes into the page as usual.
final class ShellWebView: WKWebView {
  /// Drag rectangles in CSS pixels from the page's top-left corner.
  var dragRegions: [CGRect] = []
  /// Receives dropped (`drop`) or pasted (`paste`) file URLs; nil leaves both to WebKit.
  var onFiles: ((_ files: [URL], _ source: String) -> Void)?
  /// Receives the encoded bitmap (PNG, TIFF or JPEG data) of a paste that carries no file URLs
  /// and no text; nil leaves such a paste to WebKit, which would insert it into the editor.
  var onPastedImage: ((_ data: Data) -> Void)?

  override func mouseDown(with event: NSEvent) {
    guard let window, isInDragRegion(event) else {
      super.mouseDown(with: event)
      return
    }
    if event.clickCount == 2 {
      Self.performTitleBarDoubleClick(window)
    } else {
      window.performDrag(with: event)
    }
  }

  private func isInDragRegion(_ event: NSEvent) -> Bool {
    guard !dragRegions.isEmpty else { return false }
    let local = convert(event.locationInWindow, from: nil)
    let page = CGPoint(x: local.x, y: isFlipped ? local.y : bounds.height - local.y)
    let scale = pageZoom * magnification
    let css = CGPoint(x: page.x / scale, y: page.y / scale)
    return dragRegions.contains { $0.contains(css) }
  }

  /// System Settings › Desktop & Dock › "Double-click a window's title bar to".
  private static func performTitleBarDoubleClick(_ window: NSWindow) {
    switch UserDefaults.standard.string(forKey: "AppleActionOnDoubleClick") {
    case "Minimize": window.performMiniaturize(nil)
    case "None": break
    default: window.performZoom(nil)
    }
  }

  // MARK: File drops

  private func droppedFiles(_ info: any NSDraggingInfo) -> [URL] {
    let options: [NSPasteboard.ReadingOptionKey: Any] = [.urlReadingFileURLsOnly: true]
    return info.draggingPasteboard.readObjects(forClasses: [NSURL.self], options: options)
      as? [URL] ?? []
  }

  override func draggingEntered(_ sender: any NSDraggingInfo) -> NSDragOperation {
    guard onFiles != nil, !droppedFiles(sender).isEmpty else {
      return super.draggingEntered(sender)
    }
    return .copy
  }

  override func draggingUpdated(_ sender: any NSDraggingInfo) -> NSDragOperation {
    guard onFiles != nil, !droppedFiles(sender).isEmpty else {
      return super.draggingUpdated(sender)
    }
    return .copy
  }

  override func prepareForDragOperation(_ sender: any NSDraggingInfo) -> Bool {
    guard onFiles != nil, !droppedFiles(sender).isEmpty else {
      return super.prepareForDragOperation(sender)
    }
    return true
  }

  override func performDragOperation(_ sender: any NSDraggingInfo) -> Bool {
    let files = droppedFiles(sender)
    guard let onFiles, !files.isEmpty else { return super.performDragOperation(sender) }
    onFiles(files, "drop")
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
