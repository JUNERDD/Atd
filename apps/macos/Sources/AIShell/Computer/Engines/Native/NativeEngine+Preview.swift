import AICore
import CoreGraphics
import Foundation

/// The live preview of an observed surface (plan §4.4): ScreenCaptureKit's window stream when
/// the observation found the window on the active Space, else the driver's capture pulled about
/// four times a second (``NativeOffSpacePreview``). The source's identity names that mode, so an
/// observation that finds the window elsewhere replaces it. Preview pixels never become an
/// observation or a capture an action may name.
extension NativeEngine: ComputerPreviewProviding {
  func previewSource(_ ref: TargetRefWire, observation: ObservationWire) async throws
    -> ComputerPreviewSource
  {
    guard let target = targets[ref.id], let place = target.observed,
      place.surfaceRefId == observation.surfaceRefId,
      let candidate = target.surfaces.entry(place.surfaceRefId)?.candidate,
      let initialFrame = NativeSurfaceProbe.frame(windowId: place.windowId, pid: pid_t(place.pid))
    else { throw Self.changed }
    let onSpace = target.observedPlacement?.onActiveSpace != false
    let isRoot = place.surfaceRefId == nil && place.cropFrame == nil
    let identity = [
      ref.id, place.windowKey, place.surfaceRefId ?? "root", String(describing: place.cropFrame),
      onSpace ? "window" : "offSpace", isRoot ? "" : String(describing: initialFrame),
    ].joined(separator: ":")
    let validate: () async throws -> Void = { [weak self] in
      guard let self else { throw Self.changed }
      _ = try self.window(of: ref)
      guard try self.surfaceRead(ref, place.surfaceRefId) == place,
        self.targets[ref.id]?.observed == place,
        let liveFrame = NativeSurfaceProbe.frame(windowId: place.windowId, pid: pid_t(place.pid)),
        isRoot || liveFrame == initialFrame
      else { throw Self.changed }
      if place.surfaceRefId != nil {
        try await NativePreviewSurface.validate(ref, candidate: candidate)
        guard try self.surfaceRead(ref, place.surfaceRefId) == place else { throw Self.changed }
      }
    }
    guard onSpace else {
      return ComputerPreviewSource(
        identity: identity, validate: validate,
        start: { [weak self] in
          try Task.checkCancellation()
          try await validate()
          let crop = place.cropFrame.map {
            $0.offsetBy(dx: -initialFrame.minX, dy: -initialFrame.minY)
          }
          return NativeOffSpacePreview(crop: crop) { [weak self] in
            await self?.windowPixels(place, onActiveSpace: false, operation: nil)
          }
        })
    }
    return ComputerPreviewSource(
      identity: identity, validate: validate,
      start: { try await Self.windowStream(place, validate: validate) })
  }

  /// ScreenCaptureKit's stream of the window, cut to the surface.
  private static func windowStream(
    _ place: NativeSurfaceRead, validate: @escaping () async throws -> Void
  ) async throws -> any ComputerPreviewStream {
    try Task.checkCancellation()
    try await validate()
    try Task.checkCancellation()
    let plan = try await NativeWindowCapture.plan(pid: place.pid, windowId: place.windowId)
    try Task.checkCancellation()
    try await validate()
    try Task.checkCancellation()
    let crop = place.cropFrame.map {
      CGRect(
        x: ($0.minX - plan.frame.minX) / plan.frame.width,
        y: ($0.minY - plan.frame.minY) / plan.frame.height,
        width: $0.width / plan.frame.width, height: $0.height / plan.frame.height)
    }
    if let crop,
      crop.minX < 0 || crop.minY < 0 || crop.maxX > 1 || crop.maxY > 1 || crop.isEmpty
        || crop.isNull
    {
      throw Self.changed
    }
    let stream = NativePreviewStream(crop: crop)
    do {
      try await withTaskCancellationHandler {
        try Task.checkCancellation()
        try await stream.start(plan: plan)
        try Task.checkCancellation()
      } onCancel: {
        Task { await stream.stop() }
      }
      return stream
    } catch {
      await stream.stop()
      throw error
    }
  }
}
