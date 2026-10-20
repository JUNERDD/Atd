import AIComputerDriverKit
import AICore
import CoreGraphics
import Foundation

/// Observing one surface of a native target (plan §4.4): its elements from a driver snapshot, a
/// capture of its window and the text recognized in that capture, as `include` asks. The tree
/// and the capture are separate reads: each carries its own time, and a capture whose window
/// frame disagrees with the tree's is reported as a conflict rather than presented as the same
/// state. A minimized window is never restored; observing it fails `targetUnavailable` with
/// `minimized`. A Chromium, Electron or WebKit window that resolving could not pin is pinned
/// visible first while it still is, so it keeps rendering in the background. What the host could
/// not provide is listed in `problems`, never papered over with another source.
extension NativeEngine {
  func observe(
    _ ref: TargetRefWire, _ operation: ObserveOperationWire, context: EngineObserveContext
  )
    async throws(ComputerFailure) -> ObservationWire
  {
    var published = false
    defer { if !published { invalidateObservation(ref) } }
    try context.check()
    if let refusal = operation.refusal { throw ComputerFailure(.unsupported, refusal) }
    try Self.requireUnlockedSession()
    try requireAccessibility()
    let include = operation.include
    var laps = context.phases.laps()
    try await refreshSurfaces(ref)
    laps.end(.surfaces)
    try context.check()
    let place = try surfaceRead(ref, operation.surfaceRefId)
    let region = try regionCrop(operation.region, ref: ref, place: place)
    let probe = try await probe(place, operation: context.operationId)
    laps.end(.probe)
    try context.check()
    guard !probe.placement.minimized else {
      throw ComputerFailure(
        .targetUnavailable,
        "The window is minimized; Atd never restores a window. Once the person restores it, "
          + "observe again.", reason: .minimized)
    }
    targets[ref.id]?.toolkit = probe.toolkit
    context.phases.note("toolkit", probe.toolkit.rawValue)
    context.phases.note("webArea", "\(probe.webAccessibility)")
    await prepare(place, toolkit: probe.toolkit, for: ref.id, phases: context.phases)
    laps.end(.prepare)
    try context.check()
    let before = Date()
    let useBy = NativeCapture.UseBy(before: before, clock: .now)
    var snapshot: DriverSnapshotResult?
    if include.tree {
      snapshot = try await self.snapshot(place, operation: context.operationId)
      laps.end(.snapshot)
      try context.check()
    }
    guard let version = targets[ref.id].map({ $0.version + 1 }) else { throw Self.changed }
    let observationId = "\(ref.id).o\(version)"
    let observation =
      snapshot.map { NativeObservation(id: observationId, snapshot: $0, root: place.root) }
      ?? NativeObservation(id: observationId, snapshotId: "", elements: [])
    var problems: [ComputerObservationProblem] = []
    if let snapshot {
      if observation.elements.isEmpty || snapshot.degradedReason == "axTreeEmpty" {
        problems.append(.treeEmpty)
      }
      if snapshot.truncated { problems.append(.treeTruncated) }
    }
    var shot = Shot()
    if include.screenshot {
      laps = context.phases.laps()
      shot = await self.shot(
        place, region: region, onActiveSpace: probe.placement.onActiveSpace,
        id: "\(observationId).c", useBy: useBy, operation: context.operationId)
      laps.end(.capture)
      problems += shot.problems
    }
    if let capture = shot.capture, place.root == .window,
      let window = observation.elements.first?.frame?.cgRect,
      !NativeSurfaceOwnership.same(window, capture.frame)
    {
      problems.append(.treeImageConflict)
    }
    // OCR and the app menu are independent reads; retain both before publishing this observation.
    let (pixels, capture) = (include.text ? shot.image : nil, shot.capture)
    async let recognized = recognize(pixels, in: capture, phases: context.phases)
    async let menuRead = menu(of: include.tree ? place : nil, ref: ref, phases: context.phases)
    let (text, menuItems) = await (recognized, menuRead)
    try context.check()
    // A Mac that locked while the reads ran showed them its stub tree; nothing of it is published.
    try Self.requireUnlockedSession()
    if include.text, text == nil { problems.append(.textUnavailable) }
    _ = try window(of: ref)
    try context.check()
    guard var target = targets[ref.id], target.ref == ref else { throw Self.changed }
    target.version = version
    target.observation = observation
    target.recognizedText = text?.map(\.text)
    target.recognizedRegion = region
    target.verificationImage = shot.image.flatMap { $0.width * $0.height <= 16_777_216 ? $0 : nil }
    target.verificationCapture = shot.capture
    target.regionalBaselines = []
    target.observed = place
    target.observedPlacement = probe.placement
    if let capture = shot.capture {
      target.remember(capture, windowKey: place.windowKey)
    } else if include.screenshot {
      // No image of the window the host returned is current any more.
      target.latestShot[place.windowKey] = nil
    }
    targets[ref.id] = target
    published = true
    let title =
      snapshot?.windowTitle ?? target.surfaces.entry(place.surfaceRefId)?.candidate.title
    return ObservationWire(
      ref: ObservationRefWire(
        id: observationId, targetRefId: ref.id, version: version, capturedAt: Date()),
      title: title, elements: observation.wireElements(in: shot.capture),
      screenshot: shot.screenshot, capabilities: Self.targetEffects,
      surfaceRefId: place.surfaceRefId, surfaces: target.surfaces.wire,
      capture: shot.capture?.wire, text: text, problems: problems.isEmpty ? nil : problems,
      treeCapturedAt: include.tree ? ComputerWireCoding.timestamp(before) : nil,
      menuItems: menuItems)
  }

  func invalidateObservation(_ ref: TargetRefWire) {
    guard var target = targets[ref.id], target.ref == ref else { return }
    target.observation = nil
    target.recognizedText = nil
    target.recognizedRegion = nil
    target.verificationImage = nil
    target.verificationCapture = nil
    target.regionalBaselines = []
    target.latestShot = [:]
    target.captures = []
    targets[ref.id] = target
  }

  /// The window area a region names (points relative to the surface's window): a rect in
  /// pixels of an earlier capture of the same surface, which must still be kept.
  private func regionCrop(
    _ region: ObserveOperationWire.Region?, ref: TargetRefWire, place: NativeSurfaceRead
  ) throws(ComputerFailure) -> CGRect? {
    guard let region else { return nil }
    guard
      let earlier = targets[ref.id]?.captures.first(where: { $0.id == region.capture }),
      earlier.surfaceRefId == place.surfaceRefId, earlier.windowId == place.windowId
    else {
      throw ComputerFailure(
        .staleObservation, "The region's capture is not a current capture of this surface.")
    }
    guard let area = earlier.windowRect(ofPixels: region.rect.cgRect) else {
      throw ComputerFailure(.unsupported, "The region lies outside its capture.")
    }
    return area
  }

  /// The app's menu, read off the main actor, when `place` (nil: no tree asked for) is in the
  /// target's own process.
  private func menu(of place: NativeSurfaceRead?, ref: TargetRefWire, phases: OperationPhases)
    async -> [ComputerMenuItemWire]?
  {
    guard let place, place.pid == ref.native?.pid else { return nil }
    let start = ContinuousClock.now
    defer { phases.add(.menu, since: start) }
    return await NativeTargetProbe.detached { NativeMenuProbe.snapshot(pid: pid_t(place.pid)) }
  }

  /// The text Vision finds in the capture, boxes in its pixels, at most
  /// ``ComputerWireLimits/maxTextBoxes``; nil when there is no capture or recognition failed.
  private func recognize(_ image: CGImage?, in capture: NativeCapture?, phases: OperationPhases)
    async -> [ComputerTextBoxWire]?
  {
    guard let image, let capture else { return nil }
    let start = ContinuousClock.now
    let found = await ScreenText.boxes(in: image, limit: ComputerWireLimits.maxTextBoxes)
    phases.add(.ocr, since: start)
    guard let boxes = found else { return nil }
    return boxes.compactMap { box in
      let text = box.text.trimmingCharacters(in: .whitespacesAndNewlines)
      guard !text.isEmpty else { return nil }
      return ComputerTextBoxWire(
        text: text, rect: ComputerRectWire(capture.pixelRect(normalized: box.box)),
        confidence: box.confidence)
    }
  }
}
