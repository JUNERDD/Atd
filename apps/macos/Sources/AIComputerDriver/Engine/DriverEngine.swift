import AIComputerDriverKit
import AppKit
import ApplicationServices
import Foundation

/// The driver's request handlers. Holds the one event factory (so every synthetic event carries
/// the same generation marker), the element-token store and the per-pid executors. Methods run on
/// a target's serial executor; they are pure functions of the request plus live system state and
/// return a `DriverResult` or throw a `DriverFailure`. `@unchecked Sendable`: its stored members
/// are each internally synchronized or immutable.
final class DriverEngine: @unchecked Sendable {
  let generation: Int
  private let factory: EventFactory
  private let store = AXElementStore()
  let executors = TargetExecutors()

  init(generation: Int) {
    self.generation = generation
    self.factory = EventFactory(generation: generation)
  }

  func hello() -> DriverHello {
    DriverHello(
      protocolVersion: driverProtocolVersion, generation: generation,
      attributedBundleId: Bundle.main.bundleIdentifier, capabilities: capabilities())
  }

  private func capabilities() -> [DriverCapability] {
    let spi = PrivateSymbols.shared
    return [
      DriverCapability(name: DriverCapabilityName.accessibility, available: AXIsProcessTrusted()),
      spi.capability(DriverCapabilityName.windowEvents),
      spi.capability(DriverCapabilityName.keyScope),
      spi.capability(DriverCapabilityName.occlusionKeepAlive),
      spi.capability(DriverCapabilityName.offSpaceCapture),
      spi.capability(DriverCapabilityName.windowServerQueries),
    ]
  }

  func probe(_ request: DriverProbeRequest) throws -> DriverProbeResult {
    guard let resolved = WindowResolver.resolve(request.target) else {
      throw DriverFailure(code: .targetGone)
    }
    let classified = ToolkitProbe.classify(pid: pid_t(request.target.pid), window: resolved.window)
    let placement = WindowResolver.placement(request.target, window: resolved.window)
    return DriverProbeResult(
      toolkit: classified.toolkit, placement: placement, webAccessibility: classified.webArea,
      routes: suggestedRoutes(toolkit: classified.toolkit))
  }

  func prepare(_ request: DriverPrepareRequest) throws -> DriverPrepareResult {
    guard let resolved = WindowResolver.resolve(request.target) else {
      throw DriverFailure(code: .targetGone)
    }
    var web: DriverWebAccessibilityOutcome?
    if request.enableWebAccessibility {
      web = WebAccessibility.enable(
        appElement: resolved.app, window: resolved.window, pid: pid_t(request.target.pid))
    }
    var pin: DriverKeepAliveOutcome?
    if request.occlusionKeepAlive {
      pin = OcclusionKeepAlive.shared.keepVisible(
        windowId: CGWindowID(request.target.windowId), bounds: resolved.bounds)
    }
    return DriverPrepareResult(webAccessibility: web, occlusionKeepAlive: pin)
  }

  func release(_ request: DriverReleaseRequest) -> DriverAck {
    OcclusionKeepAlive.shared.release(windowId: CGWindowID(request.target.windowId))
    return DriverAck()
  }

  func snapshot(_ request: DriverSnapshotRequest) throws -> DriverSnapshotResult {
    guard let resolved = WindowResolver.resolve(request.target) else {
      store.invalidate(windowId: CGWindowID(request.target.windowId))
      throw DriverFailure(code: .targetGone)
    }
    let result = AXSnapshotBuilder.build(
      window: resolved.window,
      maxElements: request.maxElements ?? AXSnapshotBuilder.defaultMaxElements,
      maxDepth: request.maxDepth ?? AXSnapshotBuilder.defaultMaxDepth)
    let snapshotId = store.register(
      windowId: CGWindowID(request.target.windowId), elements: result.refs)
    return DriverSnapshotResult(
      snapshotId: snapshotId, target: request.target,
      windowTitle: AXBindings.copyString(resolved.window, kAXTitleAttribute as String),
      elements: result.elements, truncated: result.degradedReason == "truncated",
      degradedReason: result.degradedReason)
  }

  func perform(_ request: DriverPerformRequest) -> Result<DriverPerformResult, DriverFailure> {
    let context = PerformContext(
      request: request, factory: factory, store: store, executors: executors)
    return PerformHandler.perform(context).map(DriverPerformResult.init(receipt:))
  }

  func capture(_ request: DriverCaptureRequest) throws -> DriverCaptureResult {
    let windowId = CGWindowID(request.target.windowId)
    // The window's width in points turns the JPEG's pixel size into the points-to-pixels scale
    // the host maps with. `CGWindowList` lists off-Space windows too, so a missing entry means the
    // window is gone; a zero width leaves no meaningful scale, so refuse rather than guess.
    guard let facts = WindowList.window(windowId) else { throw DriverFailure(code: .targetGone) }
    guard facts.bounds.width > 0 else {
      throw DriverFailure(code: .capabilityUnavailable, message: "window has no width in points")
    }
    guard
      let capture = OffSpaceCapture.capture(
        windowId: windowId, maxLongEdge: request.maxLongEdge,
        windowPointWidth: Double(facts.bounds.width))
    else {
      throw DriverFailure(
        code: .capabilityUnavailable, message: "off-Space capture returned no image")
    }
    return DriverCaptureResult(
      jpegBase64: capture.jpegBase64, pixelWidth: capture.pixelWidth,
      pixelHeight: capture.pixelHeight, scaleFactor: capture.scaleFactor)
  }

  /// A conservative route hint for `probe`. The host owns the real ladder; this only tells it
  /// which rungs the driver believes are even possible for the toolkit. Opaque and
  /// pointer-reading toolkits get AX-only.
  private func suggestedRoutes(toolkit: DriverToolkit) -> [DriverRoute] {
    var routes: [DriverRoute] = [.axAction, .axText, .axMenu, .axScroll]
    let windowEvents = PrivateSymbols.shared.capability(DriverCapabilityName.windowEvents).available
    let keyScope = PrivateSymbols.shared.capability(DriverCapabilityName.keyScope).available
    switch toolkit {
    case .opaque, .java:
      break  // pointer reads the real cursor (java) or no AX (opaque): AX only
    default:
      if windowEvents {
        routes.append(.pointer)
        routes.append(.scroll)
      }
      if windowEvents, keyScope {
        routes.append(.keys)
      }
    }
    return Array(routes.prefix(6))
  }
}
