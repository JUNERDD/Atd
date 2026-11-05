import AppKit
import QuartzCore
import Testing

@testable import AIShell

@MainActor
@Suite("Native glass tuning lifecycle", .serialized, .enabled(if: !NSScreen.screens.isEmpty))
struct GlassTunerTests {
  @Test("Repeated factors do not compound and returning to system restores the native inputs")
  func factorsRestore() async throws {
    guard #available(macOS 26, *) else { return }
    let fixture = GlassTunerFixture()
    defer {
      GlassTuner.shared.apply(.system)
      fixture.close()
    }
    GlassTuner.shared.apply(.system)
    try await fixture.settle()
    let layer = try #require(GlassTunerFixture.layers(in: fixture.glass.layer).first)
    let original = try #require(GlassTunerFixture.input("inputBlurRadius", on: layer))
    #expect(original > 0)
    GlassTuner.shared.track(fixture.glass, skipping: fixture.page)
    for index in 0..<100 {
      let factor = index.isMultiple(of: 2) ? 0.5 : 0.75
      GlassTuner.shared.apply(.init(blur: factor))
      let actual = try #require(GlassTunerFixture.input("inputBlurRadius", on: layer))
      #expect(abs(actual - original * factor) < 0.0001)
      GlassTuner.shared.apply(.init(blur: factor))
      #expect(GlassTunerFixture.input("inputBlurRadius", on: layer) == actual)
    }
    #expect(GlassTunerFixture.counts().observing)
    GlassTuner.shared.apply(.system)
    #expect(GlassTunerFixture.input("inputBlurRadius", on: layer) == original)
    #expect(GlassTunerFixture.counts().records == 0)
    #expect(!GlassTunerFixture.counts().observing)
  }

  @Test("Filter replacement tunes synchronously without recursive compounding")
  func systemFilterReplacement() async throws {
    guard #available(macOS 26, *) else { return }
    let fixture = GlassTunerFixture()
    defer {
      GlassTuner.shared.apply(.system)
      fixture.close()
    }
    GlassTuner.shared.apply(.system)
    try await fixture.settle()
    let layer = try #require(GlassTunerFixture.layers(in: fixture.glass.layer).first)
    let base = try #require(GlassTunerFixture.input("inputBlurRadius", on: layer))
    GlassTuner.shared.track(fixture.glass, skipping: fixture.page)
    GlassTuner.shared.apply(.init(blur: 0.5))
    for index in 0..<100 {
      // Recreate the system's update boundary: new filter input followed by its filters setter.
      // Check before yielding, so a later run-loop correction cannot make this assertion pass.
      let systemValue = base * (index.isMultiple(of: 2) ? 0.9 : 1.1)
      layer.setValue(systemValue, forKeyPath: "filters.glassBackground.inputBlurRadius")
      layer.filters = layer.filters
      let actual = try #require(GlassTunerFixture.input("inputBlurRadius", on: layer))
      #expect(abs(actual - systemValue * 0.5) < 0.0001)
    }
  }

  @Test("The skipped page subtree keeps system glass while native window glass is tuned")
  func pageSubtreeIsExcluded() async throws {
    guard #available(macOS 26, *) else { return }
    let fixture = GlassTunerFixture()
    let pageGlass = NSGlassEffectView(frame: NSRect(x: 20, y: 20, width: 120, height: 80))
    pageGlass.contentView = NSView()
    fixture.page.addSubview(pageGlass)
    defer {
      GlassTuner.shared.apply(.system)
      fixture.close()
    }
    GlassTuner.shared.apply(.system)
    try await fixture.settle()
    let pageLayer = try #require(GlassTunerFixture.layers(in: pageGlass.layer).first)
    let initial = try #require(GlassTunerFixture.input("inputBlurRadius", on: pageLayer))
    GlassTuner.shared.track(fixture.glass, skipping: fixture.page)
    GlassTuner.shared.apply(.init(blur: 2, refractionWidth: 0, refractionStrength: 2))
    #expect(GlassTunerFixture.input("inputBlurRadius", on: pageLayer) == initial)
    #expect(GlassTunerFixture.counts().observing)
  }

  @Test("Window and material disposal releases native layers while custom tuning stays enabled")
  func disposedNativeObjectsRelease() async throws {
    guard #available(macOS 26, *) else { return }
    defer { GlassTuner.shared.apply(.system) }
    func cycles(_ count: Int, factors: GlassTuner.Factors) async throws {
      var windows: [GlassWeakReference<NSWindow>] = []
      var views: [GlassWeakReference<NSView>] = []
      var layers: [GlassWeakReference<CALayer>] = []
      GlassTuner.shared.apply(factors)
      let started = CFAbsoluteTimeGetCurrent()
      for index in 0..<count {
        let fixture = GlassTunerFixture(style: index.isMultiple(of: 2) ? .regular : .clear)
        GlassTuner.shared.track(fixture.glass, skipping: fixture.page)
        try await fixture.settle()
        let found = GlassTunerFixture.layers(in: fixture.glass.layer)
        #expect(!found.isEmpty)
        windows.append(GlassWeakReference(fixture.window))
        views.append(GlassWeakReference(fixture.glass))
        layers += found.map { GlassWeakReference($0) }
        fixture.glass.style = index.isMultiple(of: 2) ? .clear : .regular
        fixture.window.setContentSize(NSSize(width: 260, height: 180))
        try await fixture.settle()
        for layer in GlassTunerFixture.layers(in: fixture.glass.layer) {
          let radius = try #require(GlassTunerFixture.input("inputBlurRadius", on: layer))
          #expect(radius > 0 && radius <= 20)
        }
        fixture.close()
      }
      try await Task.sleep(for: .milliseconds(100))
      CATransaction.flush()
      let retainedWindows = windows.filter { $0.value != nil }.count
      let retainedViews = views.filter { $0.value != nil }.count
      let retainedLayers = layers.filter { $0.value != nil }.count
      let counts = GlassTunerFixture.counts()
      print(
        "glass-cycles=\(count) custom=\(factors != .system) seconds=\(CFAbsoluteTimeGetCurrent() - started) retained-windows=\(retainedWindows) retained-views=\(retainedViews) retained-layers=\(retainedLayers) roots=\(counts.roots) live-records=\(counts.records)"
      )
      #expect(retainedViews == 0)
      #expect(retainedLayers == 0)
      #expect(counts.records == 0)
    }
    // Closed-window retention varies with AppKit cache timing and other suites' windows. Record
    // it diagnostically; the tuner's material views, layers and live records must all release.
    try await cycles(24, factors: .system)
    try await cycles(
      48, factors: .init(blur: 1.5, refractionWidth: 0.5, refractionStrength: 1.5))
  }

  @Test("Registrations end with their views while system factors leave tuning idle")
  func systemBookkeepingIsBounded() async throws {
    guard #available(macOS 26, *) else { return }
    GlassTuner.shared.apply(.system)
    let baseline = GlassTunerFixture.counts().roots
    var rootReferences: [GlassWeakReference<NSView>] = []
    var skipReferences: [GlassWeakReference<NSView>] = []
    var layerReferences: [GlassWeakReference<CALayer>] = []
    try autoreleasepool {
      var roots: [NSView] = []
      for _ in 0..<64 {
        let view = NSView()
        let skip = NSView()
        view.addSubview(skip)
        view.wantsLayer = true
        GlassTuner.shared.track(view, skipping: skip)
        rootReferences.append(GlassWeakReference(view))
        skipReferences.append(GlassWeakReference(skip))
        layerReferences.append(GlassWeakReference(try #require(view.layer)))
        roots.append(view)
      }
      #expect(GlassTunerFixture.counts().roots == baseline + 64)
      roots.removeAll()
    }
    #expect(rootReferences.allSatisfy { $0.value == nil })
    #expect(skipReferences.allSatisfy { $0.value == nil })
    #expect(GlassTunerFixture.counts().roots == baseline)
    // Layer backing-store teardown finishes with Core Animation's pending commit; registry and
    // view ownership above must already have ended without a run-loop sweep.
    CATransaction.flush()
    try await Task.sleep(for: .milliseconds(30))
    #expect(layerReferences.allSatisfy { $0.value == nil })
    #expect(!GlassTunerFixture.counts().observing)
    #expect(GlassTunerFixture.counts().records == 0)
    let final = GlassTunerFixture.counts().roots
    print("glass-system roots-before=\(baseline) roots-after=\(final)")
    #expect(final == baseline)
  }

  @Test("Page exclusion prevents traversal of a large composited page subtree")
  func pageTraversalIsBounded() async throws {
    guard #available(macOS 26, *) else { return }
    let fixture = GlassTunerFixture()
    defer {
      GlassTuner.shared.apply(.system)
      fixture.close()
    }
    fixture.page.wantsLayer = true
    let pageRoot = GlassTraversalLayer()
    fixture.page.layer = pageRoot
    for _ in 0..<2_000 { pageRoot.addSublayer(GlassTraversalLayer()) }
    try await fixture.settle()
    GlassTuner.shared.track(fixture.glass, skipping: fixture.page)
    GlassTraversalLayer.reads = 0
    GlassTuner.shared.apply(.init(blur: 0.5))
    #expect(GlassTraversalLayer.reads == 0)
    // Control establishes that this fixture detects traversal if the page exclusion is removed.
    GlassTuner.shared.track(fixture.glass)
    let started = CFAbsoluteTimeGetCurrent()
    for index in 0..<100 {
      GlassTuner.shared.apply(.init(blur: index.isMultiple(of: 2) ? 0.5 : 0.75))
    }
    let unexcludedReads = GlassTraversalLayer.reads
    print(
      "glass-page unexcluded-visits=\(unexcludedReads) seconds=\(CFAbsoluteTimeGetCurrent() - started)"
    )
    #expect(unexcludedReads >= 2_000)
    GlassTuner.shared.track(fixture.glass, skipping: fixture.page)
  }
}
