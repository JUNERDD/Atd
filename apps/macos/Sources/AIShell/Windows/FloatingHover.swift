import AppKit
import SwiftUI

/// Hover for controls in a nonactivating window. The host follows the pointer with one shared
/// clock; the native Button or gesture keeps ownership of clicks, focus and accessibility. The
/// region's ``PointerRole`` sets the cursor: a control that acts on a click keeps the default.
struct FloatingHover: ViewModifier {
  let enabled: Bool
  let pointer: PointerRole
  let moved: ((CGPoint) -> Void)?
  let changed: (Bool) -> Void
  @Environment(\.isEnabled) private var isEnabled
  @Environment(\.floatingHoverActive) private var active

  init(
    enabled: Bool = true, pointer: PointerRole = .action,
    moved: ((CGPoint) -> Void)? = nil, changed: @escaping (Bool) -> Void
  ) {
    self.enabled = enabled
    self.pointer = pointer
    self.moved = moved
    self.changed = changed
  }

  func body(content: Content) -> some View {
    content.background {
      FloatingHoverRegion(
        enabled: enabled && isEnabled && active, pointer: pointer, moved: moved,
        changed: changed)
    }
  }
}

private struct FloatingHoverActiveKey: EnvironmentKey {
  static let defaultValue = true
}

extension EnvironmentValues {
  var floatingHoverActive: Bool {
    get { self[FloatingHoverActiveKey.self] }
    set { self[FloatingHoverActiveKey.self] = newValue }
  }
}

protocol FloatingHoverHost: AnyObject {
  var hoverRegions: FloatingHoverRegions { get }
  var hoverInteractive: Bool { get }
}

/// A non-hit-testing native view reports the clipped, current button bounds, including window
/// moves and scroll offsets. It never replaces the control that owns the actual interaction.
private struct FloatingHoverRegion: NSViewRepresentable {
  let enabled: Bool
  let pointer: PointerRole
  let moved: ((CGPoint) -> Void)?
  let changed: (Bool) -> Void

  func makeNSView(context: Context) -> FloatingHoverRegionView {
    let view = FloatingHoverRegionView()
    configure(view)
    return view
  }

  func updateNSView(_ view: FloatingHoverRegionView, context: Context) { configure(view) }

  private func configure(_ view: FloatingHoverRegionView) {
    view.enabled = enabled
    view.pointer = pointer
    view.moved = moved
    view.changed = changed
  }

  static func dismantleNSView(_ view: FloatingHoverRegionView, coordinator: ()) { view.detach() }
}

final class FloatingHoverRegionView: NSView {
  var enabled = true
  var pointer = PointerRole.action
  var moved: ((CGPoint) -> Void)?
  var changed: (Bool) -> Void = { _ in }
  private weak var regions: FloatingHoverRegions?

  override var isFlipped: Bool { true }
  override func hitTest(_ point: NSPoint) -> NSView? { nil }

  override func viewDidMoveToWindow() {
    super.viewDidMoveToWindow()
    detach()
    guard let host = window as? any FloatingHoverHost else { return }
    regions = host.hoverRegions
    regions?.add(self)
  }

  func detach() {
    regions?.remove(self)
    regions = nil
  }

  var screenBounds: CGRect? {
    guard enabled, !isHiddenOrHasHiddenAncestor, let window, window.isVisible,
      (window as? any FloatingHoverHost)?.hoverInteractive == true
    else { return nil }
    let visible = visibleRect.intersection(bounds)
    guard !visible.isEmpty else { return nil }
    return window.convertToScreen(convert(visible, to: nil))
  }

  func localPoint(_ point: CGPoint) -> CGPoint? {
    guard let window else { return nil }
    return convert(window.convertPoint(fromScreen: point), from: nil)
  }
}

/// Shared hit testing for one window. Most-specific visible controls win; equal-sized controls
/// use their stacking/registration order. Only a target change writes a hover state. A region
/// may also follow the local pointer, e.g. one timeline region for many step markers.
final class FloatingHoverRegions {
  var onFirstRegion: ((NSView) -> Void)?
  var onEmpty: (() -> Void)?
  private final class WeakRegion {
    weak var view: FloatingHoverRegionView?
    init(_ view: FloatingHoverRegionView) { self.view = view }
  }
  private var regions: [WeakRegion] = []
  private weak var hovered: FloatingHoverRegionView?
  var hoveredWindow: NSWindow? { hovered?.window }
  private var lastPoint: CGPoint?
  private let windowHit = FloatingWindowHitTest()

  func add(_ view: FloatingHoverRegionView) {
    regions.removeAll { $0.view == nil || $0.view === view }
    let first = regions.isEmpty
    regions.append(WeakRegion(view))
    if first { onFirstRegion?(view) }
  }

  func remove(_ view: FloatingHoverRegionView) {
    regions.removeAll { $0.view == nil || $0.view === view }
    if hovered === view {
      hovered = nil
      lastPoint = nil
      let changed = view.changed
      // A region can leave during SwiftUI's update; clear its state on the next turn.
      DispatchQueue.main.async { [weak self] in
        guard self?.hovered == nil else { return }
        changed(false)
      }
    }
    if regions.isEmpty { onEmpty?() }
  }

  func isNear(_ point: CGPoint, margin: CGFloat = 24) -> Bool {
    regions.contains {
      $0.view?.screenBounds?.insetBy(dx: -margin, dy: -margin).contains(point) == true
    }
  }

  @discardableResult func update(_ point: CGPoint, active: Bool = true) -> NSCursor? {
    var target: FloatingHoverRegionView?
    var smallest = CGFloat.infinity
    if active {
      for region in regions.reversed() {
        guard let view = region.view, let bounds = view.screenBounds, bounds.contains(point)
        else { continue }
        let area = bounds.width * bounds.height
        if area < smallest {
          target = view
          smallest = area
        }
      }
    }
    // `visibleRect` clips inside the window but does not account for another window covering it.
    // Match AppKit's actual click target so an obscured surface cannot claim hover or the cursor.
    if let window = target?.window, windowHit.window(at: point) != window.windowNumber {
      target = nil
    }
    if target !== hovered {
      let previous = hovered
      hovered = target
      lastPoint = nil
      // Enter first: linked timeline rows then keep the new preview when the old one leaves.
      target?.changed(true)
      previous?.changed(false)
    }
    if let target, let moved = target.moved, let local = target.localPoint(point),
      local != lastPoint
    {
      lastPoint = local
      moved(local)
    }
    guard let target else { return nil }
    return target.pointer.cursor
  }
}

/// AppKit's point hit test is much smaller than a full window-list snapshot. Reuse it within a
/// display interval, but check again promptly if a window moves over a stationary pointer.
final class FloatingWindowHitTest {
  private var lastPoint: CGPoint?
  private var checkedAt = -Double.infinity
  private var number = 0

  func window(at point: CGPoint) -> Int {
    let now = ProcessInfo.processInfo.systemUptime
    if point != lastPoint || now - checkedAt >= 1.0 / 60.0 {
      number = NSWindow.windowNumber(at: point, belowWindowWithWindowNumber: 0)
      checkedAt = now
      lastPoint = point
    }
    return number
  }

  /// Another Atd surface may already own the cursor on the same pointer move. Releasing this
  /// one must not overwrite that surface's cursor with an arrow.
  func releaseCursor(from window: NSWindow?) {
    let top = self.window(at: NSEvent.mouseLocation)
    if let other = NSApp.window(withWindowNumber: top), other !== window { return }
    NSCursor.arrow.set()
  }
}
