import AIComputerDriverKit
import AICore
import CoreGraphics
import Foundation

/// Where one surface's elements and pixels come from: the window that holds it (a sheet,
/// popover or menu lives in its parent's window, a service panel in its own process) and where
/// its elements start in that window's snapshot.
struct NativeSurfaceRead: Equatable {
  /// nil for the target's root surface.
  let surfaceRefId: String?
  let pid: Int
  let windowId: Int
  let root: NativeObservation.Root
  /// The surface's own frame inside a larger window capture, which its screenshot is cut to.
  let cropFrame: CGRect?

  /// The window's key, for its newest snapshot, capture and pin.
  var windowKey: String { "\(pid):\(windowId)" }
  var driverTarget: DriverTarget { DriverTarget(pid: pid, windowId: windowId) }
}

extension NativeEngine {
  /// The app a target's demotions are keyed by, read once when it resolves.
  struct AppIdentity: Equatable {
    let bundleId: String
    let version: String
  }

  /// One resolved target and what the engine knows of it: the latest observation (element refs
  /// resolve only against it), the live surfaces, and the captures observations returned.
  struct Target {
    let ref: TargetRefWire
    let app: AppIdentity
    var version = 0
    var observation: NativeObservation?
    /// Exact OCR order and geometry published by the latest observation, for its text refs.
    var recognizedTextBoxes: [ComputerTextBoxWire]?
    /// The same observed text remains the baseline for visual checks.
    var recognizedText: [String]? { recognizedTextBoxes?.map(\.text) }
    /// The same window-relative crop must be compared when checking new OCR text.
    var recognizedRegion: CGRect?
    /// Only the current observation's pixels, bounded to the accepted screenshot size.
    var verificationImage: CGImage?
    var verificationCapture: NativeCapture?
    /// Prepared once before input; waits and the final check use the same regional baseline.
    var regionalBaselines: [NativeRegionBaseline] = []
    /// Where the latest observation was read; nil until observed.
    var observed: NativeSurfaceRead?
    /// Where that surface's window sat when it was observed, which picks the preview's source.
    var observedPlacement: DriverWindowPlacement?
    var surfaces: NativeSurfaceSet
    /// The captures of recent observations, newest last.
    var captures: [NativeCapture] = []
    /// The newest capture of each window: only its image points are honored.
    var latestShot: [String: String] = [:]
    /// The app's windows at the last surface listing, and whether the host sent input to the
    /// target since: windows that appear after an action are attributed to it.
    var knownWindows: Set<Int> = []
    var acted = false
    /// Captures a click, a drag or a caret placement already aimed through; each is used once.
    var spent: Set<String> = []
    /// The toolkit the driver last classified a window of the target as.
    var toolkit: DriverToolkit?
    /// Whether the coordinator released the ref (no live run uses it). A released ref still
    /// works while the driver runs, but no longer keeps it running.
    var released = false

    init(ref: TargetRefWire, app: AppIdentity, root: NativeSurfaceOwnership.Candidate) {
      self.ref = ref
      self.app = app
      surfaces = NativeSurfaceSet(targetRefId: ref.id, root: root)
    }

    /// Captures kept per target; older ones can no longer be named by an image point.
    static let captureLimit = 8

    mutating func remember(_ capture: NativeCapture, windowKey: String) {
      captures.append(capture)
      if captures.count > Self.captureLimit { captures.removeFirst() }
      latestShot[windowKey] = capture.id
    }
  }

  /// The root surface of a window as resolving lists it, before any observation.
  static func rootSurface(
    pid: Int, processStart: String, windowId: Int, title: String?, frame: CGRect?
  ) -> NativeSurfaceOwnership.Candidate {
    NativeSurfaceOwnership.Candidate(
      key: "w\(windowId)", parentKey: nil, kind: .window, basis: .root, modal: false,
      title: title, pid: pid, processStart: processStart, windowId: windowId, readPid: pid,
      readWindowId: windowId, frame: frame, role: "AXWindow")
  }

  /// What a native target supports per step kind (spec §2), with the routes its toolkit takes
  /// (``NativeRoutePlan/routes(for:facts:)``): `background` delivery where a route is open,
  /// `foreground` beside it, or alone, for the kinds whose foreground input reaches the window's
  /// toolkit when the request allows the foreground (`foreground`, R8,
  /// ``ForegroundPolicy/delivery(_:background:foreground:postsEvents:toolkit:)``), and no delivery
  /// at all otherwise. An image point is
  /// offered only where the event rung it needs is open, which never holds for a kind listed with
  /// the foreground alone: capture points never run in the foreground. No step carries
  /// verification evidence for application targets yet.
  static func capabilities(_ facts: NativeRouteFacts, foreground: Bool)
    -> [TargetCapabilityWire]
  {
    let element: [TargetCapabilityWire.Locate] = [.element, .semantic]
    let open = { (route: DriverRoute) in facts.exclusion(of: route) == nil }
    let kinds: [(ComputerStepKind, [TargetCapabilityWire.Locate])] = [
      (.setValue, element), (.press, element), (.wait, []),
      (.click, open(.pointer) ? element + [.image] : element), (.key, element),
      (.type, open(.pointer) && open(.text) ? element + [.image] : element), (.clear, element),
      (.menu, []), (.scroll, open(.scroll) ? element + [.image] : element),
      (.drag, open(.drag) ? element + [.image] : element),
    ]
    return kinds.map { kind, locate in
      guard kind != .wait else {
        return TargetCapabilityWire(
          action: kind, locate: locate, delivery: [.background], verified: false)
      }
      var routes: [ActionResultWire.Route] = []
      for route in NativeRoutePlan.routes(for: kind, facts: facts)
      where !routes.contains(route.wire) {
        routes.append(route.wire)
      }
      return TargetCapabilityWire(
        action: kind, locate: locate,
        delivery: ForegroundPolicy.delivery(
          kind, background: !routes.isEmpty, foreground: foreground,
          postsEvents: facts.postsEvents, toolkit: facts.toolkit),
        verified: false, routes: routes)
    }
  }

  /// The effects an observed native target accepts.
  static let targetEffects: [ComputerEffect] = [.read, .input, .click, .invoke, .submit]

  /// The route facts for a window of `toolkit`, with no route demoted.
  func routeFacts(toolkit: DriverToolkit) -> NativeRouteFacts {
    NativeRouteFacts(
      toolkit: toolkit, capabilities: capabilities, postsEvents: CGPreflightPostEventAccess(),
      policy: configuration.routes)
  }

  /// The routes the guard demoted for a `kind` step of `run` on a window of `toolkit` of `app`,
  /// with how long each stays off.
  func demoted(
    in app: AppIdentity, toolkit: DriverToolkit, kind: ComputerStepKind, run: String
  ) -> [DriverRoute: RouteDemotion] {
    var off: [DriverRoute: RouteDemotion] = [:]
    for route in DriverRoute.all {
      let key = NativeDemotion(
        bundleId: app.bundleId, appVersion: app.version, toolkit: toolkit, route: route.wire,
        kind: kind)
      if let demotion = demotions[key], demotion.applies(to: run) { off[route] = demotion }
    }
    return off
  }

  func demote(
    _ route: ActionResultWire.Route, for kind: ComputerStepKind, on ref: TargetRefWire,
    run: String
  ) -> RouteDemotion? {
    guard ref.engineGeneration == generation, let target = targets[ref.id],
      let toolkit = target.toolkit
    else { return nil }
    let key = NativeDemotion(
      bundleId: target.app.bundleId, appVersion: target.app.version, toolkit: toolkit,
      route: route, kind: kind)
    let demotion = RouteDemotion.after(demotions[key], run: run)
    demotions[key] = demotion
    let span = demotion == .everyRun ? "in every run" : "for the rest of its run"
    Self.log.notice(
      "Demoted \(route.rawValue, privacy: .public) for \(kind.rawValue, privacy: .public) in \(target.app.bundleId, privacy: .public) \(span, privacy: .public) after a disturbance."
    )
    return demotion
  }
}
