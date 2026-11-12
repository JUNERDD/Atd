import AICore
import AppKit

/// What the editor's text commands ask of the session while the capture stays open: the selection
/// as it shows now, for a result card's Copy Screenshot (decision D9) and the screenshot a command
/// attaches.
extension CaptureSession {
  /// The committed selection's pixels with its annotations, and the app and window frontmost at
  /// its centre in the window snapshot taken before the overlays; nil without a committed
  /// selection or when nothing could be rendered (it lies in a gap between displays).
  func shootSelection() -> CaptureSelectionShot? {
    guard case .selected(let rect) = phase,
      let rendered = CaptureExport.render(selection: rect, desktop: desktop, editor: editor)
    else { return nil }
    let described = longScreenshot.snapshot.describe(
      at: desktop.geometry.quartzPoint(CGPoint(x: rect.midX, y: rect.midY)))
    return CaptureSelectionShot(
      image: rendered.image, scale: rendered.scale, size: rect.size, app: described.app,
      window: described.window)
  }
}
