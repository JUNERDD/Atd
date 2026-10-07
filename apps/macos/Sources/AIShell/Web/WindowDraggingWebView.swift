import AppKit
import WebKit

/// A web view whose page moves its window from the regions it reports (plan decision R9, zone C).
/// WKWebView ignores `-webkit-app-region`, so the page pushes its drag rectangles and a mouse-down
/// inside one starts a native window drag synchronously, while the event is still current. A
/// double-click there runs the system's title bar action.
class WindowDraggingWebView: WKWebView {
  /// Drag rectangles in CSS pixels from the page's top-left corner.
  var dragRegions: [CGRect] = []

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
}
