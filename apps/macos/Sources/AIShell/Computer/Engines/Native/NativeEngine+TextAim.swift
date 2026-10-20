import AIComputerDriverKit
import AICore
import CoreGraphics
import Foundation

/// Aiming a pointer step at text the window shows (``NativeRecognizedText``). The action's
/// surface is read again when the step runs and the text is found in those pixels, never in the
/// observation's: since the observation the window may have moved, been resized or zoomed,
/// changed displays or reflowed its content, and only current pixels show where the text is now.
/// The read is bounded like an observation's screenshot, so its text reads as the model saw it,
/// and maps through its own frame and pixels per point. Its window must keep its size until the
/// point is mapped; a full window that only moved meanwhile is followed through its live origin,
/// as an unused capture is, while a sheet or popover must also keep its place. The read leaves
/// the observation, its captures and its baselines untouched.
extension NativeEngine {
  func textAim(_ text: String, ref: TargetRefWire, context: EngineStepContext)
    async throws(ComputerFailure) -> NativeRoutePlan.Aim
  {
    guard CGPreflightScreenCaptureAccess() else {
      throw ComputerFailure(
        .needsPermission,
        "Atd needs Screen & System Audio Recording permission to find text on the screen; "
          + "nothing was sent.")
    }
    let place = try observedRead(ref)
    let onActiveSpace = targets[ref.id]?.observedPlacement?.onActiveSpace ?? true
    guard
      let pixels = await windowPixels(
        place, onActiveSpace: onActiveSpace, operation: context.operationId),
      NativeCapture.scale(
        frame: pixels.frame, width: pixels.image.width, height: pixels.image.height) != nil
    else { throw Self.unreadable }
    try dispatchable(context)
    let edge = Self.screenshotEdge
    let whole = await NativeTargetProbe.detached {
      NativeCaptureImage.bounded(pixels.image, longEdge: edge)
    }
    let surface = place.cropFrame.map {
      CGRect(
        x: $0.minX - pixels.frame.minX, y: $0.minY - pixels.frame.minY, width: $0.width,
        height: $0.height)
    }
    let read = NativeCapture(
      id: "\(ref.id).text", surfaceRefId: place.surfaceRefId, pid: place.pid,
      windowId: place.windowId, frame: pixels.frame, crop: surface, mime: .png,
      sourceWidth: whole.width, sourceHeight: whole.height, capturedAt: Date())
    guard let image = surface == nil ? whole : whole.cropping(to: read.sourcePixels),
      let boxes = await ScreenText.boxes(in: image, limit: ComputerWireLimits.maxTextBoxes)
    else { throw Self.unreadable }
    try dispatchable(context)
    let recognized = boxes.compactMap { box -> ComputerTextBoxWire? in
      let shown = box.text.trimmingCharacters(in: .whitespacesAndNewlines)
      guard !shown.isEmpty else { return nil }
      return ComputerTextBoxWire(
        text: shown, rect: ComputerRectWire(read.pixelRect(normalized: box.box)),
        confidence: box.confidence)
    }
    let found: ComputerTextBoxWire
    switch NativeRecognizedText.locate(text, in: recognized) {
    case .success(let box): found = box
    case .failure(let failure): throw ComputerFailure(failure.code, failure.message)
    }
    guard let live = NativeSurfaceProbe.frame(windowId: place.windowId, pid: pid_t(place.pid)),
      surface == nil ? read.matches(size: live.size) : read.matches(frame: live)
    else {
      throw ComputerFailure(
        .staleObservation,
        "The window changed size or place while its text was read; nothing was sent. "
          + "Try the step again.")
    }
    let rect = found.rect.cgRect
    let start = read.screenPoint(x: Int(rect.minX), y: Int(rect.minY), windowOrigin: live.origin)
    let end = read.screenPoint(x: Int(rect.maxX), y: Int(rect.maxY), windowOrigin: live.origin)
    let shown = CGRect(x: start.x, y: start.y, width: end.x - start.x, height: end.y - start.y)
    if let geometry = NativeTargetProbe.screenGeometry(shown) {
      context.report(.located(geometry))
    }
    return .text(DriverPoint(x: shown.midX, y: shown.midY), found.text)
  }

  private static let unreadable = ComputerFailure(
    .unsupported, "The window's text could not be read to find the step's text; nothing was sent.")
}
