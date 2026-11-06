import AppKit
import QuartzCore
import Testing

@testable import AIShell

/// Native glass without a web page, app activation or persistent preference writes.
@MainActor
@available(macOS 26, *)
final class GlassTunerFixture {
  let window: NSWindow
  let glass = NSGlassEffectView()
  let page = NSView()

  init(style: NSGlassEffectView.Style = .regular) {
    _ = NSApplication.shared
    window = NSWindow(
      contentRect: NSRect(x: 40, y: 40, width: 240, height: 160),
      styleMask: .borderless, backing: .buffered, defer: false)
    window.isReleasedWhenClosed = false
    window.backgroundColor = .clear
    window.isOpaque = false
    glass.style = style
    glass.contentView = page
    window.contentView = glass
    window.orderBack(nil)
  }

  func settle() async throws {
    window.displayIfNeeded()
    CATransaction.flush()
    try await Task.sleep(for: .milliseconds(30))
  }

  func close() {
    window.orderOut(nil)
    window.contentView = nil
    glass.contentView = nil
    window.close()
  }

  static func layers(in layer: CALayer?) -> [CALayer] {
    guard let layer else { return [] }
    let selector = NSSelectorFromString("name")
    let isGlass =
      layer.filters?.contains { filter in
        guard let object = filter as? NSObject, object.responds(to: selector) else { return false }
        return object.value(forKey: "name") as? String == "glassBackground"
      } ?? false
    return (isGlass ? [layer] : []) + (layer.sublayers ?? []).flatMap { layers(in: $0) }
  }

  static func input(_ key: String, on layer: CALayer) -> Double? {
    (layer.value(forKeyPath: "filters.glassBackground.\(key)") as? NSNumber)?.doubleValue
  }

  /// Diagnostic counts of the real owner's private bookkeeping, without production test hooks.
  static func counts() -> (roots: Int, records: Int, observing: Bool) {
    let fields = Dictionary(
      uniqueKeysWithValues: Mirror(reflecting: GlassTuner.shared).children
        .compactMap { child in child.label.map { ($0, child.value) } })
    let roots =
      (fields["roots"] as? NSMapTable<AnyObject, AnyObject>)?
      .keyEnumerator().allObjects.count ?? -1
    // A weak map can keep dead slots in count until compaction; count live keys instead.
    let records =
      (fields["records"] as? NSMapTable<AnyObject, AnyObject>)?
      .keyEnumerator().allObjects.count ?? -1
    let observing = fields["observer"].map { !Mirror(reflecting: $0).children.isEmpty } ?? false
    return (roots, records, observing)
  }
}

@MainActor
final class GlassWeakReference<T: AnyObject> {
  weak var value: T?
  init(_ value: T) { self.value = value }
}

/// Counts the actual tuner's traversal without changing its production implementation.
final class GlassTraversalLayer: CALayer {
  nonisolated(unsafe) static var reads = 0

  override var filters: [Any]? {
    get {
      Self.reads += 1
      return super.filters
    }
    set { super.filters = newValue }
  }
}
