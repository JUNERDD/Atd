import AICore
import AppKit

/// One sleeping pointer clock for all desktop pins. Native tracking areas can deliver their
/// first enter late while another app is active; approaching a resize corner must wake before
/// that enter. Each corner's existing watcher continues to own its cursor once it is shown.
final class DesktopPinHover {
  static let shared = DesktopPinHover()

  private final class Region {
    weak var corner: DesktopPinCorner?
    weak var view: NSView?

    init(_ corner: DesktopPinCorner, view: NSView) {
      self.corner = corner
      self.view = view
    }
  }

  private let pointer = MiniPanelPointer()
  private let windowHit = FloatingWindowHitTest()
  private var regions: [Region] = []
  private weak var anchor: NSView?
  private var obscuredAt: CGPoint?

  private init() {
    pointer.onMove = { [weak self] point, _ in self?.update(point) }
    pointer.onFrame = { [weak self] _, _ in self?.update(NSEvent.mouseLocation) }
    pointer.isNear = { [weak self] point in self?.isNear(point) == true }
  }

  func add(_ corner: DesktopPinCorner, in view: NSView) {
    regions.removeAll { $0.corner == nil || $0.view == nil || $0.corner === corner }
    regions.append(Region(corner, view: view))
    if anchor == nil {
      anchor = view
      pointer.start(in: view)
    }
    pointer.wake()
  }

  func remove(_ corner: DesktopPinCorner) {
    let removedAnchor = regions.contains { $0.corner === corner && $0.view === anchor }
    regions.removeAll { $0.corner == nil || $0.view == nil || $0.corner === corner }
    if regions.isEmpty {
      pointer.stop()
      anchor = nil
      obscuredAt = nil
    } else if removedAnchor, let view = regions.first?.view {
      anchor = view
      pointer.start(in: view)
    }
  }

  func wake() { pointer.wake() }

  private var isWatchingCorner: Bool {
    regions.contains { $0.corner?.isShowing == true }
  }

  private func isNear(_ point: CGPoint) -> Bool {
    guard !isWatchingCorner, point != obscuredAt else { return false }
    return regions.contains { region in
      guard let corner = region.corner, corner.directions != nil,
        let window = region.view?.window, window.isVisible
      else { return false }
      let frame = window.frame
      let extent = DesktopPinGeometry.resizeCorner + 24
      return frame.insetBy(dx: -24, dy: -24).contains(point)
        && min(abs(point.x - frame.minX), abs(point.x - frame.maxX)) <= extent
        && min(abs(point.y - frame.minY), abs(point.y - frame.maxY)) <= extent
    }
  }

  private func update(_ point: CGPoint) {
    guard NSEvent.pressedMouseButtons & 1 == 0, !isWatchingCorner else { return }
    let candidates = regions.compactMap { region -> (DesktopPinCorner, NSWindow)? in
      guard let corner = region.corner, let window = region.view?.window, window.isVisible,
        window.frame.contains(point),
        corner.corner(at: window.convertPoint(fromScreen: point)) != nil
      else { return nil }
      return (corner, window)
    }
    guard !candidates.isEmpty else {
      obscuredAt = nil
      return
    }
    let top = windowHit.window(at: point)
    guard let (corner, window) = candidates.first(where: { $0.1.windowNumber == top }) else {
      obscuredAt = point
      return
    }
    obscuredAt = nil
    corner.update(at: window.convertPoint(fromScreen: point))
  }
}
