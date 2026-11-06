import AppKit
import WebKit

@testable import AIShell

/// Uses the product panel, WebKit subclass, title bar and glass composition. Only the document
/// is a fixture: fixed contenteditable/input targets isolate OS event routing from React state.
@MainActor
final class FocusPanel {
  private let mode: FocusMode
  private let panel: NSPanel
  private let webView: WKWebView
  private let pageBridge: FocusPageBridge
  private var peer: Process?
  private var temporary: URL?
  private var monitor: Any?
  private var mouseDowns = 0
  private var keyDowns = 0

  var ownsFocus: Bool {
    let front = NSWorkspace.shared.frontmostApplication?.processIdentifier
    return front == getpid() || front == peer?.processIdentifier
  }

  init(mode: FocusMode, tuned: Bool, pageGlass: String) throws {
    self.mode = mode
    guard let work = NSScreen.main?.visibleFrame, work.width >= 850 else {
      throw FocusError.failed("An interactive display at least 850 points wide is required")
    }
    let configuration = WKWebViewConfiguration()
    configuration.websiteDataStore = .nonPersistent()
    WebKitPrivate.enableSystemAppearance(configuration.preferences)
    webView =
      mode == .legacy
      ? LegacyFocusWebView(frame: .zero, configuration: configuration)
      : ShellWebView(frame: .zero, configuration: configuration)
    WebKitPrivate.disableBackground(webView)
    webView.underPageBackgroundColor = .clear
    webView.autoresizingMask = [.width, .height]
    var style: NSWindow.StyleMask = [
      .titled, .closable, .miniaturizable, .resizable, .fullSizeContentView,
    ]
    if mode != .regular { style.insert(.nonactivatingPanel) }
    let frame = CGRect(x: work.minX + 350, y: work.minY + 70, width: 460, height: 400)
    panel =
      mode == .legacy
      ? LegacyFocusPanel(contentRect: frame, styleMask: style, backing: .buffered, defer: false)
      : ShellPanel(contentRect: frame, styleMask: style, backing: .buffered, defer: false)
    pageBridge = FocusPageBridge(webView: webView)
    panel.delegate = pageBridge
    UnifiedTitleBar.apply(to: panel, identifier: "fixture.panel.titleBar")
    panel.title = "Atd product panel focus probe"
    panel.isOpaque = false
    panel.backgroundColor = .clear
    panel.hidesOnDeactivate = false
    panel.becomesKeyOnlyIfNeeded = false
    panel.isReleasedWhenClosed = false
    panel.collectionBehavior = [.fullScreenAuxiliary, .moveToActiveSpace]
    let container = NSView()
    container.addSubview(webView)
    panel.contentView = GlassBackground.make(content: container)
    if mode == .native {
      // configureClickActivation can silently keep its fallback. This control is meaningful
      // only when the private capability really exists with the expected scalar ABI.
      guard PanelClickActivation.configure(panel) else {
        throw FocusError.failed("Native click activation capability unavailable")
      }
      guard let productPanel = panel as? ShellPanel else {
        throw FocusError.failed("Native mode requires product ShellPanel")
      }
      productPanel.configureClickActivation()
    }
    GlassTuner.shared.apply(
      tuned ? .init(blur: 2, refractionWidth: 1.5, refractionStrength: 1.5) : .system)
    panel.orderFrontRegardless()
    panel.makeKey()
    webView.loadHTMLString(FocusPage.html(glass: pageGlass), baseURL: nil)
    monitor = NSEvent.addLocalMonitorForEvents(matching: [.leftMouseDown, .keyDown]) {
      [weak self] event in
      MainActor.assumeIsolated {
        if event.window === self?.panel {
          if event.type == .leftMouseDown { self?.mouseDowns += 1 }
          if event.type == .keyDown { self?.keyDowns += 1 }
        }
      }
      return event
    }
  }

  func close() {
    if let monitor { NSEvent.removeMonitor(monitor) }
    monitor = nil
    if let peer, peer.isRunning { peer.terminate() }
    peer = nil
    panel.delegate = nil
    pageBridge.close()
    webView.stopLoading()
    panel.close()
    GlassTuner.shared.apply(.system)
    if let temporary { try? FileManager.default.removeItem(at: temporary) }
    temporary = nil
  }

  func run(cycles: Int, scenario: String) async throws -> FocusResult {
    guard
      try await FocusEvents.wait(
        seconds: 10,
        until: {
          (try? await self.webView.evaluateJavaScript(
            "document.readyState === 'complete' && !!document.getElementById('composer')")) as? Bool
            == true
            && self.webView.bounds.width > 100
        })
    else { throw FocusError.failed("WebKit document did not load") }
    let directory = FileManager.default.temporaryDirectory
      .appendingPathComponent("AtdPanelFocus-\(UUID().uuidString)", isDirectory: true)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    temporary = directory
    let stateURL = directory.appendingPathComponent("peer.json")
    let process = Process()
    process.executableURL = URL(fileURLWithPath: CommandLine.arguments[0])
    process.arguments = ["peer", stateURL.path]
    process.standardOutput = FileHandle.nullDevice
    process.standardError = FileHandle.standardError
    try process.run()
    peer = process
    guard
      try await FocusEvents.wait(
        seconds: 10,
        until: {
          FileManager.default.fileExists(atPath: stateURL.path)
        })
    else { throw FocusError.failed("Peer did not start") }

    var result = FocusResult(status: "completed", mode: mode.rawValue)
    for cycle in 0..<cycles {
      let target = cycle.isMultiple(of: 2) ? "composer" : "search"
      let before = try await activatePeer(stateURL)
      if scenario == "clear" { try FocusLifecycle.changeGlassVariant(panel, cycle: cycle) }

      let script = """
        (() => {
          for (const el of document.querySelectorAll('input,[contenteditable]')) {
            if (el.tagName === 'INPUT') el.value = ''; else el.textContent = '';
          }
          window.pointerDowns = 0; window.keyDowns = 0;
          const r = document.getElementById('\(target)').getBoundingClientRect();
          return JSON.stringify({x:r.x+r.width/2, y:r.y+r.height/2});
        })()
        """
      let point: PagePoint = try await decode(script)
      // Put the fixture above other application windows. Reordering does not activate it;
      // the peer remains frontmost and owns the keyboard until the measured HID click.
      panel.orderFrontRegardless()
      try await Task.sleep(for: .milliseconds(100))
      guard NSWorkspace.shared.frontmostApplication?.processIdentifier == before.pid else {
        throw FocusError.failed("Panel ordering unexpectedly activated another application")
      }
      let screenPoint = try FocusEvents.screenPoint(
        view: webView, point: CGPoint(x: point.x, y: point.y))
      FileHandle.standardError.write(
        Data(
          "panel point=\(screenPoint) webBounds=\(webView.bounds) \(FocusEvents.describe(panel))\n"
            .utf8))
      // WindowServer lists system click-through surfaces too (for example Dock's whole-screen
      // layer). Record them, then establish delivery from the real native mouse event below.
      FocusEvents.recordCoveringWindow(panel, at: screenPoint)
      result.samples.append(try await measure(cycle: cycle, target: target, point: screenPoint))
      if scenario == "head-policy" || scenario == "release-policy" {
        let release = scenario == "release-policy"
        try await FocusLifecycle.changePresence(release: release)
        let immediate = try await presenceState(target)
        try await Task.sleep(for: .milliseconds(200))
        let settled = try await presenceState(target)
        result.presenceClosures.append(
          FocusPresenceClosure(
            cycle: cycle, version: release ? "v0.10.6" : "HEAD-145500a3",
            immediate: immediate, settled: settled))
        _ = try await activatePeer(stateURL)
        let after: PagePoint = try await decode(script)
        panel.orderFrontRegardless()
        try await Task.sleep(for: .milliseconds(100))
        guard NSWorkspace.shared.frontmostApplication?.processIdentifier == before.pid else {
          throw FocusError.failed("Policy control lost peer frontmost before measured click")
        }
        let afterPoint = try FocusEvents.screenPoint(
          view: webView, point: CGPoint(x: after.x, y: after.y))
        result.samples.append(
          try await measure(
            cycle: cycle, target: target, point: afterPoint, phase: "policy-click"))
        continue
      }
      if scenario == "presence" { try await FocusLifecycle.changePresence() }
      if scenario == "pinned" { FocusLifecycle.changePin(panel, cycle: cycle) }
      if scenario != "visible" {
        // Product hide/show behavior, with the existing DOM target retained. The peer proves
        // it owns the real keyboard while hidden; no DOM focus call assists the summon.
        panel.alphaValue = 0
        panel.ignoresMouseEvents = true
        _ = try await activatePeer(stateURL)
        _ = try await webView.evaluateJavaScript(
          """
          (() => { const el=document.getElementById('\(target)');
            if(el.tagName==='INPUT')el.value='';else el.textContent='';
            window.pointerDowns=0;window.keyDowns=0; })()
          """)
        result.samples.append(try await measure(cycle: cycle, target: target, point: nil))
      }
    }
    if result.samples.contains(where: { !$0.passed }) { result.status = "focus-failure" }
    result.webContentTerminations = pageBridge.terminations
    result.bridgeDeliveryFailures = pageBridge.deliveryFailures
    return result
  }

  private func activatePeer(_ url: URL) async throws -> FocusPeerState {
    let before = try readPeer(url)
    try await FocusEvents.click(CGPoint(x: before.x, y: before.y))
    try FocusEvents.typeCharacter()
    guard
      try await FocusEvents.wait(until: {
        let state = try self.readPeer(url)
        return state.active && state.key && state.characters == before.characters + 1
          && NSWorkspace.shared.frontmostApplication?.processIdentifier == state.pid
      })
    else {
      let observed = try readPeer(url)
      throw FocusError.failed(
        "Peer control failed: expectedLength=\(before.characters + 1), "
          + "observedLength=\(observed.characters), active=\(observed.active), "
          + "key=\(observed.key), peerPid=\(observed.pid), "
          + "frontPid=\(NSWorkspace.shared.frontmostApplication?.processIdentifier ?? -1)")
    }
    return before
  }

  private func measure(cycle: Int, target: String, point: CGPoint?, phase: String? = nil)
    async throws -> FocusSample
  {
    let beforePage = try await state(target)
    mouseDowns = 0
    keyDowns = 0
    let start = ContinuousClock.now
    if let point {
      // Exactly one click. No explicit makeKey/activate/focus call rescues this transition.
      try await FocusEvents.click(point)
    } else {
      // The measured summon follows PanelWindowController.show; it never activates the app.
      panel.alphaValue = 1
      panel.ignoresMouseEvents = false
      panel.orderFrontRegardless()
      panel.makeKey()
    }
    try await Task.sleep(for: .milliseconds(100))
    try FocusEvents.typeCharacter()
    _ = try await FocusEvents.wait(
      seconds: 1,
      until: {
        try await self.state(target).length == 1
      })
    let duration = start.duration(to: .now).components
    return FocusSample(
      cycle: cycle, field: target, phase: phase ?? (point == nil ? "summon" : "click"),
      outerGlassStyle: FocusLifecycle.glassVariant(panel),
      peerFrontmost: NSWorkspace.shared.frontmostApplication?.processIdentifier
        == peer?.processIdentifier,
      appActive: NSApp.isActive, windowKey: panel.isKeyWindow,
      responder: panel.firstResponder.map { String(describing: type(of: $0)) } ?? "nil",
      nativeMouseDowns: mouseDowns, nativeKeyDowns: keyDowns,
      elapsedMilliseconds: Double(duration.seconds) * 1000
        + Double(duration.attoseconds) / 1e15,
      beforePage: beforePage, page: try await state(target))
  }

  private func presenceState(_ target: String) async throws -> FocusPresenceState {
    // Native flags are read immediately, before awaiting the content-process snapshot. Neither
    // observation restores focus, makes a window key, types, or clicks anything after close.
    let active = NSApp.isActive
    let key = panel.isKeyWindow
    let front = NSWorkspace.shared.frontmostApplication?.processIdentifier
    let responder = panel.firstResponder.map { String(describing: type(of: $0)) } ?? "nil"
    return FocusPresenceState(
      appActive: active, panelKey: key, peerFrontmost: front == peer?.processIdentifier,
      fixtureFrontmost: front == getpid(), responder: responder, page: try await state(target))
  }

  private struct PagePoint: Decodable {
    let x: Double
    let y: Double
  }

  private func readPeer(_ url: URL) throws -> FocusPeerState {
    try JSONDecoder().decode(FocusPeerState.self, from: Data(contentsOf: url))
  }

  private func state(_ target: String) async throws -> FocusPageState {
    try await decode(
      """
      (() => {
        const el = document.getElementById('\(target)');
        const r = el.getBoundingClientRect();
        const hit = document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);
        const surface = el.closest('.surface-glass');
        return JSON.stringify({active:document.activeElement?.id ?? '',
          focused:document.hasFocus(), length:(el.value ?? el.textContent).length,
          pointerDowns:window.pointerDowns, keyDowns:window.keyDowns,
          bridgeEvents:window.bridgeEvents,windowActive:document.documentElement.dataset.windowActive,
          supportsGlass:CSS.supports('-apple-visual-effect','-apple-system-glass-material'),
          visualEffect:getComputedStyle(surface).getPropertyValue('-apple-visual-effect'),
          hitIsTarget:hit===el||el.contains(hit)});
      })()
      """)
  }

  private func decode<T: Decodable>(_ script: String) async throws -> T {
    guard let json = try await webView.evaluateJavaScript(script) as? String else {
      throw FocusError.failed("Page did not return JSON")
    }
    return try JSONDecoder().decode(T.self, from: Data(json.utf8))
  }

}
