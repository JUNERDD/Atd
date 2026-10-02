import AICore
import AppKit

/// `share.text`: the system share picker for a text, anchored to a rectangle of the page.
enum ShareSheet {
  /// Shows the picker below `anchor` and returns; the choice is not reported back. Throws when
  /// the text is blank or the web view is not in a window.
  static func show(text: String, anchor: ShareTextParams.Anchor, in view: ShellWebView)
    throws(BridgeError)
  {
    guard !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
      throw BridgeError("There is nothing to share.")
    }
    guard view.window != nil else {
      throw BridgeError("The window is not available to share from.")
    }
    let picker = NSSharingServicePicker(items: [text])
    picker.show(
      relativeTo: viewRect(for: anchor, in: view), of: view,
      preferredEdge: view.isFlipped ? .maxY : .minY)
  }

  /// CSS pixels from the page's top-left to the view's coordinates: scaled by the page zoom, and
  /// mirrored vertically when the view's origin is at the bottom-left.
  private static func viewRect(for anchor: ShareTextParams.Anchor, in view: ShellWebView)
    -> NSRect
  {
    let zoom = view.pageZoom * view.magnification
    let width = anchor.width * zoom
    let height = anchor.height * zoom
    let top = anchor.y * zoom
    let y = view.isFlipped ? top : view.bounds.height - top - height
    return NSRect(x: anchor.x * zoom, y: y, width: width, height: height)
  }
}
