import AppKit
import QuartzCore

/// A surface the live pointer's marks are drawn on: a display's overlay (``PointerOverlay``) or a
/// monitor picture (``ComputerMonitorPointerOverlay``). Callers lay a mark out in the canvas's view
/// space, which has its origin at the top-left and y down, and put it on ``canvas`` through
/// ``layer(_:)``, because the canvas layer is not flipped.
protocol PointerCanvas: AnyObject {
  /// The display the canvas covers; 0 for a canvas that belongs to none, like a monitor picture.
  var displayID: CGDirectDisplayID { get }
  /// The canvas's extent. Marks keep their labels inside its size.
  var bounds: CGRect { get }
  /// Backing pixels per point.
  var scale: CGFloat { get }
  var canvas: CALayer { get }
}

extension PointerCanvas {
  /// A view-space point (y down from the top) in the canvas (y up).
  func layer(_ point: CGPoint) -> CGPoint {
    CGPoint(x: point.x, y: bounds.height - point.y)
  }

  /// A view-space rect in the canvas.
  func layer(_ rect: CGRect) -> CGRect {
    CGRect(x: rect.minX, y: bounds.height - rect.maxY, width: rect.width, height: rect.height)
  }
}
