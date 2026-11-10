import AppKit

/// Where a card's media is on the screen, for its lightbox to grow from and go back to.
extension IslandController {
  /// `rect`, in the island's content (SwiftUI's global space in its hosting view), on the screen
  /// in Cocoa coordinates; nil for nil, or while the window has no content.
  func screenRect(_ rect: CGRect?) -> CGRect? {
    guard let rect, let view = window.contentView else { return nil }
    let local =
      view.isFlipped
      ? rect
      : CGRect(
        x: rect.minX, y: view.bounds.height - rect.maxY, width: rect.width, height: rect.height)
    return window.convertToScreen(view.convert(local, to: nil))
  }
}
