import AppKit
import QuartzCore

/// Liquid Glass's blur and edge refraction relative to the values the system sets (``Factors``),
/// on the glass of the page windows (the panel, Settings, generative views) and of
/// the floating surfaces, as the Panel background setting asks (``PanelBackground/tuning``). No
/// public API offers them, so this is private API throughout, kept to this one type.
///
/// Contract:
/// - Liquid Glass draws through a `CABackdropLayer` whose `glassBackground` filter holds the
///   inputs `inputBlurRadius`, `inputInnerRefractionHeight` and `inputInnerRefractionAmount`, in
///   AppKit's `NSGlassEffectView` and SwiftUI's `glassEffect` alike (measured on macOS 26.4).
///   AppKit and SwiftUI set that layer's `filters` anew, at the system's values, on every resize
///   and on every frame of an animated shape, and build a new layer on tint, appearance, focus or
///   variant changes. They do it inside a Core Animation transaction they commit at once (AppKit's
///   visually atomic changes, around SwiftUI's display list update too), so that frame reaches the
///   screen before any run loop observer runs: corrected only afterwards, the floating surfaces'
///   glass showed the system's blur on every frame of their springs. So the tuner observes each
///   glass layer's `filters` (``observeFilters(of:)``) and tunes them from inside the setter, in
///   the system's own transaction: a value it did not write is the system's new base, and the
///   factor's value for it goes on top of it (``Factors/value(of:factor:base:)``).
/// - After each Core Animation commit (a main run loop observer ordered after Core Animation's
///   own) the tuner walks its roots for glass layers, tuning and observing those it has not seen;
///   a new layer's first frame shows the system's values.
/// - Only the roots given to ``track(_:skipping:)`` are tuned, each without its `skipping`
///   subtree: a page window's web view, whose in-page glass WebKit mirrors into this process and
///   which stays the system's. A root counts while its window is on screen, transparent or not: a
///   window ordered in transparent and drawn before it fades in (the command island, the resident
///   panel) has its glass tuned and observed before its first visible frame.
/// - Every private access is guarded: a filter is recognized by its `name` only on objects that
///   answer `name`, and an input is read through the layer's `filters.<name>.<input>` key path,
///   which reads nil for a filter or input that no longer exists; a nil read leaves the layer
///   alone, and only inputs that were read are written. An AppKit or SwiftUI that renames them
///   gets the system's glass, never a trap.
/// - With every factor at 1 it does no work at all: no observer is installed. Returning to 1
///   writes the system's values back where the tuner's still stand and removes the observers.
/// - macOS 26 only: macOS 15 has no Liquid Glass, and the tuner stays idle there.
final class GlassTuner {
  static let shared = GlassTuner()

  /// The setting's factors on the system's values; 1 leaves a value the system's.
  struct Factors: Equatable {
    var blur = 1.0
    var refractionWidth = 1.0
    var refractionStrength = 1.0

    static let system = Factors()

    /// The blur radius past which text behind the glass no longer reads, judged by eye over 13 to
    /// 24 pt text on bare regular and clear glass (macOS 26.4): what the blur factor's top reaches.
    static let concealingBlurRadius = 20.0
    /// The top of the blur factor's range (`PANEL_GLASS_TUNING_RANGE.blur` in the contracts).
    static let maximumBlur = 2.0

    /// The glass filter's inputs and their factors.
    fileprivate var inputs: [(key: String, factor: Double)] {
      [
        ("inputBlurRadius", blur),
        ("inputInnerRefractionHeight", refractionWidth),
        ("inputInnerRefractionAmount", refractionStrength),
      ]
    }

    /// What input `key` holds at `factor` over the system's `base`. Refraction is the multiple of
    /// the system's. Blur is too up to 1 (at least half, the range's bottom), but above 1 rises
    /// from the system's radius to ``concealingBlurRadius`` at ``maximumBlur``: the system's own
    /// radius differs tenfold by variant and window state (regular 4; clear 10 in a window that is
    /// not key, 1 in the key window), so a plain multiple left text readable behind the focused
    /// Settings window at the top of the range.
    fileprivate static func value(of key: String, factor: Double, base: Double) -> Double {
      guard key == "inputBlurRadius", factor > 1 else { return base * factor }
      let rise = (factor - 1) / (maximumBlur - 1)
      return base + min(rise, 1) * max(0, concealingBlurRadius - base)
    }
  }

  /// What the tuner last found and wrote on one glass layer, per input, and its observation of
  /// the layer's filters, which ends with the record.
  private final class Record {
    var base: [String: Double] = [:]
    var written: [String: Double] = [:]
    var observation: NSKeyValueObservation?
  }

  private struct Root {
    weak var view: NSView?
    weak var skip: NSView?
  }

  private struct Write {
    let layer: CALayer
    let key: String
    let value: Double
  }

  private static let filterName = "glassBackground"
  private static let nameSelector = NSSelectorFromString("name")

  private var factors = Factors.system
  private var roots: [ObjectIdentifier: Root] = [:]
  /// Per glass layer, weakly: a rebuilt layer starts from the system's values again. Removing a
  /// record ends its observation.
  private let records = NSMapTable<CALayer, Record>.weakToStrongObjects()
  private var observer: CFRunLoopObserver?

  /// Tunes the glass under `root`, leaving `skip`'s subtree alone, for as long as `root` lives.
  /// Neither is retained; tracking costs nothing while every factor is 1.
  func track(_ root: NSView, skipping skip: NSView? = nil) {
    roots[ObjectIdentifier(root)] = Root(view: root, skip: skip)
  }

  /// Takes `factors` for every tracked glass from now on.
  func apply(_ factors: Factors) {
    guard #available(macOS 26, *), factors != self.factors else { return }
    self.factors = factors
    if factors == .system {
      stop()
    } else {
      start()
      enforce()
    }
  }

  private func start() {
    guard observer == nil else { return }
    // Ordered after Core Animation's commit observer (2_000_000), so a value the system wrote in
    // this pass is caught before the run loop sleeps; in the common modes, so it also runs during
    // a live resize or a tracking loop.
    let observer = CFRunLoopObserverCreateWithHandler(
      nil, CFRunLoopActivity.beforeWaiting.rawValue, true, 2_000_001
    ) { _, _ in
      MainActor.assumeIsolated { GlassTuner.shared.enforce() }
    }
    CFRunLoopAddObserver(CFRunLoopGetMain(), observer, .commonModes)
    self.observer = observer
  }

  /// Removes the observers and writes the system's values back on every glass layer whose input
  /// still holds the tuner's value.
  private func stop() {
    if let observer {
      CFRunLoopObserverInvalidate(observer)
      self.observer = nil
    }
    var writes: [Write] = []
    for case let layer as CALayer in records.keyEnumerator().allObjects {
      guard let record = records.object(forKey: layer) else { continue }
      for (key, written) in record.written {
        guard let base = record.base[key], base != written, Self.read(key, on: layer) == written
        else { continue }
        writes.append(Write(layer: layer, key: key, value: base))
      }
    }
    records.removeAllObjects()
    Self.commit(writes)
  }

  private func enforce() {
    guard observer != nil else { return }
    var seen = Set<ObjectIdentifier>()
    var writes: [Write] = []
    for (id, root) in roots {
      guard let view = root.view else {
        roots[id] = nil
        continue
      }
      guard let window = view.window, window.isVisible, let layer = view.layer else { continue }
      for glass in Self.glassLayers(in: layer, skipping: root.skip?.layer)
      where seen.insert(ObjectIdentifier(glass)).inserted {
        writes += tune(glass)
      }
    }
    Self.commit(writes)
  }

  /// The filters the system has just set on an observed glass layer, tuned inside its setter, so
  /// the writes join the transaction that carries the system's values.
  private func filtersDidChange(on layer: CALayer) {
    guard observer != nil else { return }
    Self.commit(tune(layer))
  }

  /// Observes the filters the system sets on `layer` (``filtersDidChange(on:)``). A setter called
  /// off the main thread is left to the next run loop pass.
  private static func observeFilters(of layer: CALayer) -> NSKeyValueObservation {
    layer.observe(\.filters) { observed, _ in
      guard Thread.isMainThread else { return }
      // The setter runs on the main thread, where `assumeIsolated` runs this synchronously: the
      // layer never leaves it.
      nonisolated(unsafe) let layer = observed
      MainActor.assumeIsolated { GlassTuner.shared.filtersDidChange(on: layer) }
    }
  }

  /// The writes that put the factors' values on `layer`'s inputs, taking any value the tuner did
  /// not write as the system's new base; a layer seen for the first time is observed from now on.
  private func tune(_ layer: CALayer) -> [Write] {
    let record = records.object(forKey: layer) ?? Record()
    records.setObject(record, forKey: layer)
    if record.observation == nil { record.observation = Self.observeFilters(of: layer) }
    var writes: [Write] = []
    for (key, factor) in factors.inputs {
      guard let current = Self.read(key, on: layer) else { continue }
      if record.written[key] != current { record.base[key] = current }
      let value = Factors.value(of: key, factor: factor, base: record.base[key] ?? current)
      record.written[key] = value
      if value != current { writes.append(Write(layer: layer, key: key, value: value)) }
    }
    return writes
  }

  private static func read(_ key: String, on layer: CALayer) -> Double? {
    (layer.value(forKeyPath: "filters.\(filterName).\(key)") as? NSNumber)?.doubleValue
  }

  /// Writes outside any animation, in one transaction.
  private static func commit(_ writes: [Write]) {
    guard !writes.isEmpty else { return }
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    for write in writes {
      write.layer.setValue(write.value, forKeyPath: "filters.\(filterName).\(write.key)")
    }
    CATransaction.commit()
  }

  /// The layers carrying the Liquid Glass filter under `layer`, without `skip`'s subtree.
  private static func glassLayers(in layer: CALayer, skipping skip: CALayer?) -> [CALayer] {
    var found: [CALayer] = []
    collect(layer, skipping: skip, into: &found)
    return found
  }

  private static func collect(
    _ layer: CALayer, skipping skip: CALayer?, into found: inout [CALayer]
  ) {
    if layer === skip { return }
    if let filters = layer.filters, filters.contains(where: isGlassFilter) { found.append(layer) }
    for sublayer in layer.sublayers ?? [] { collect(sublayer, skipping: skip, into: &found) }
  }

  private static func isGlassFilter(_ filter: Any) -> Bool {
    guard let filter = filter as? NSObject, filter.responds(to: nameSelector) else { return false }
    return filter.value(forKey: "name") as? String == filterName
  }
}
