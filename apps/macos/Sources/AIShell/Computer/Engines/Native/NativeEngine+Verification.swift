import AICore
import CoreGraphics
import Foundation

/// A region's immutable pre-input evidence, cut from pixels the agent actually observed.
struct NativeRegionBaseline {
  let region: ObserveOperationWire.Region
  let capture: NativeCapture
  let windowRect: CGRect
  let texts: [String]
}

extension NativeEngine {
  func prepareRegion(
    _ region: ObserveOperationWire.Region, action: ComputerActionWire, baseline: ObservationWire
  ) async throws(ComputerFailure) -> [String] {
    guard let target = targets[action.targetRefId], target.observation?.id == baseline.ref.id,
      let capture = target.verificationCapture, capture.id == region.capture,
      baseline.capture?.id == capture.id, capture.surfaceRefId == target.observed?.surfaceRefId,
      let image = target.verificationImage
    else {
      throw ComputerFailure(
        .staleObservation, "The region needs the action's current observed image.")
    }
    if let prepared = target.regionalBaselines.first(where: { $0.region == region }) {
      return prepared.texts
    }
    let rect = region.rect.cgRect
    let bounds = CGRect(x: 0, y: 0, width: image.width, height: image.height)
    guard rect.width > 0, rect.height > 0, bounds.contains(rect),
      let windowRect = capture.windowRect(ofPixels: rect),
      let cut = image.cropping(to: rect.integral)
    else { throw ComputerFailure(.unsupported, "The verification region is outside its capture.") }
    let texts = try await verificationTexts(cut)
    guard targets[action.targetRefId]?.observation?.id == baseline.ref.id,
      targets[action.targetRefId]?.verificationCapture?.id == capture.id
    else { throw Self.changed }
    targets[action.targetRefId]?.regionalBaselines.append(
      NativeRegionBaseline(region: region, capture: capture, windowRect: windowRect, texts: texts))
    return texts
  }

  func regionalNewText(
    _ region: ObserveOperationWire.Region, pattern: String?, ref: TargetRefWire, operation: String?
  ) async throws(ComputerFailure) -> Bool {
    guard let baseline = targets[ref.id]?.regionalBaselines.first(where: { $0.region == region })
    else {
      throw ComputerFailure(
        .staleObservation, "The regional baseline was not prepared before input.")
    }
    let now = try await screenTexts(
      ref, region: baseline.windowRect, operation: operation, expected: baseline.capture)
    return try Self.hasNewText(now, baseline: baseline.texts, pattern: pattern)
  }

  /// Fresh verification pixels use their own read (ScreenCaptureKit, or the driver's capture on
  /// another Space). The observation's captures and element snapshot are untouched, including
  /// when a wait polls the same region repeatedly.
  func screenTexts(
    _ ref: TargetRefWire, region: CGRect? = nil, operation: String?, expected: NativeCapture? = nil
  ) async throws(ComputerFailure) -> [String] {
    if let operation, stopping.contains(operation) {
      throw ComputerFailure(.cancelled, "Screen verification was cancelled.")
    }
    guard CGPreflightScreenCaptureAccess() else {
      throw ComputerFailure(
        .needsPermission,
        "Atd needs Screen & System Audio Recording permission to read text on the screen.")
    }
    _ = try window(of: ref)
    let observed = try observedRead(ref)
    if observed.surfaceRefId != nil { try await refreshSurfaces(ref) }
    let place = try surfaceRead(ref, observed.surfaceRefId)
    guard place == observed else { throw Self.surfaceGone }
    let capture = expected ?? targets[ref.id]?.verificationCapture
    // A root-window region is already relative to its window. Child surfaces retain their
    // stricter global crop checks; every capture must still stay stationary while it is read.
    let allowsTranslation = region != nil && place.surfaceRefId == nil && place.cropFrame == nil
    let before = try verificationFrame(
      place, capture: capture, allowsTranslation: allowsTranslation)
    let onActiveSpace = targets[ref.id]?.observedPlacement?.onActiveSpace ?? true
    guard
      let image = await windowPixels(place, onActiveSpace: onActiveSpace, operation: operation)?
        .image
    else {
      throw ComputerFailure(.unsupported, "The window could not be captured for verification.")
    }
    if place.surfaceRefId != nil { try await refreshSurfaces(ref) }
    _ = try window(of: ref)
    guard try surfaceRead(ref, place.surfaceRefId) == place,
      NativeSurfaceOwnership.same(
        before, try verificationFrame(place, capture: capture, allowsTranslation: allowsTranslation)
      ),
      let scale = NativeCapture.scale(frame: before, width: image.width, height: image.height)
    else {
      throw ComputerFailure(.staleObservation, "The verification window changed during capture.")
    }
    let surfaceCrop = place.cropFrame.map {
      CGRect(x: $0.minX - before.minX, y: $0.minY - before.minY, width: $0.width, height: $0.height)
    }
    let area = region ?? surfaceCrop
    let result: CGImage
    if let area {
      let bounds = CGRect(origin: .zero, size: before.size)
      guard bounds.contains(area), area.width > 0, area.height > 0,
        let cut = image.cropping(
          to: NativeCapture.pixels(
            of: area, scale: scale, within: CGSize(width: image.width, height: image.height)))
      else {
        throw ComputerFailure(
          .staleObservation, "The verification region no longer fits the window.")
      }
      result = cut
    } else {
      result = image
    }
    let texts = try await verificationTexts(result)
    _ = try window(of: ref)
    guard try surfaceRead(ref, place.surfaceRefId) == place,
      NativeSurfaceOwnership.same(
        before, try verificationFrame(place, capture: capture, allowsTranslation: allowsTranslation)
      )
    else { throw Self.surfaceGone }
    if let operation, stopping.contains(operation) {
      throw ComputerFailure(.cancelled, "Screen verification was cancelled.")
    }
    return texts
  }

  private func verificationFrame(
    _ place: NativeSurfaceRead, capture: NativeCapture?, allowsTranslation: Bool
  )
    throws(ComputerFailure) -> CGRect
  {
    guard let frame = NativeSurfaceProbe.frame(windowId: place.windowId, pid: pid_t(place.pid))
    else { throw Self.surfaceGone }
    if let capture {
      guard capture.pid == place.pid, capture.windowId == place.windowId,
        capture.surfaceRefId == place.surfaceRefId,
        allowsTranslation ? capture.matches(size: frame.size) : capture.matches(frame: frame)
      else {
        throw ComputerFailure(
          .staleObservation, "The verification capture no longer matches its window.")
      }
    }
    return frame
  }

  private func verificationTexts(_ image: CGImage) async throws(ComputerFailure) -> [String] {
    guard let boxes = await ScreenText.boxes(in: image, limit: ComputerWireLimits.maxTextBoxes)
    else {
      throw ComputerFailure(.unsupported, "The screenshot could not be read for verification.")
    }
    return boxes.compactMap {
      let text = $0.text.trimmingCharacters(in: .whitespacesAndNewlines)
      return text.isEmpty ? nil : text
    }
  }
}
