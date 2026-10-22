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
  private struct TextAnchor {
    let observationId: String
    let capture: NativeCapture
    let windowRect: CGRect
  }

  /// An OCR ref retains the box the model chose; it is never an accessibility or image-point ref.
  func ocrTextAim(
    _ textRef: String, ref: TargetRefWire, in observation: NativeObservation,
    context: EngineStepContext
  ) async throws(ComputerFailure) -> NativeRoutePlan.Aim {
    guard let target = targets[ref.id], target.observation?.id == observation.id,
      let capture = target.verificationCapture, capture.id == "\(observation.id).c",
      let entry = target.recognizedTextBoxes?.enumerated().first(where: {
        textRef == "ocr:\(observation.id):\($0.offset)"
      })
    else {
      throw Self.staleTextReference("The OCR reference is not part of the current observation.")
    }
    guard let windowRect = capture.windowRect(ofPixels: entry.element.rect.cgRect) else {
      throw Self.staleTextReference("The OCR reference has no valid region in its capture.")
    }
    return try await readTextAim(
      entry.element.text,
      anchor: TextAnchor(
        observationId: observation.id, capture: capture, windowRect: windowRect),
      ref: ref, context: context)
  }

  func textAim(_ text: String, ref: TargetRefWire, context: EngineStepContext)
    async throws(ComputerFailure) -> NativeRoutePlan.Aim
  {
    try await readTextAim(text, anchor: nil, ref: ref, context: context)
  }

  private func readTextAim(
    _ text: String, anchor: TextAnchor?, ref: TargetRefWire, context: EngineStepContext
  ) async throws(ComputerFailure) -> NativeRoutePlan.Aim {
    guard CGPreflightScreenCaptureAccess() else {
      throw ComputerFailure(
        .needsPermission,
        "Atd needs Screen & System Audio Recording permission to find text on the screen; "
          + "nothing was sent.")
    }
    let place = try observedRead(ref)
    let onActiveSpace = targets[ref.id]?.observedPlacement?.onActiveSpace ?? true
    var laps = context.phases.laps()
    let captured = await windowPixels(
      place, onActiveSpace: onActiveSpace, operation: context.operationId)
    laps.end(.capture)
    guard let pixels = captured else { throw Self.unreadable }
    guard
      NativeCapture.scale(
        frame: pixels.frame, width: pixels.image.width, height: pixels.image.height) != nil
    else {
      guard anchor != nil else { throw Self.unreadable }
      throw Self.staleTextReference(
        "The fresh capture dimensions do not match its window geometry.")
    }
    try dispatchable(context)
    if let anchor { try validateTextAnchor(anchor, ref: ref, place: place, frame: pixels.frame) }
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
    guard let image = surface == nil ? whole : whole.cropping(to: read.sourcePixels) else {
      throw Self.unreadable
    }
    let textBoxes = await ScreenText.boxes(in: image, limit: ComputerWireLimits.maxTextBoxes)
    laps.end(.ocr)
    guard let boxes = textBoxes else { throw Self.unreadable }
    try dispatchable(context)
    let recognized = boxes.compactMap { box -> ComputerTextBoxWire? in
      let shown = box.text.trimmingCharacters(in: .whitespacesAndNewlines)
      guard !shown.isEmpty else { return nil }
      return ComputerTextBoxWire(
        text: shown, rect: ComputerRectWire(read.pixelRect(normalized: box.box)),
        confidence: box.confidence)
    }
    // Only fresh OCR provides a point. Geometry narrows the candidates; it cannot replace text
    // evidence or pick a nearby match when the observed control no longer has a counterpart.
    let candidates =
      anchor.map { anchor in
        recognized.filter { box in
          guard let rect = read.windowRect(ofPixels: box.rect.cgRect) else { return false }
          let tolerance = NativeCapture.tolerance
          return anchor.windowRect.insetBy(dx: -tolerance, dy: -tolerance).contains(
            CGPoint(x: rect.midX, y: rect.midY))
            && rect.insetBy(dx: -tolerance, dy: -tolerance).contains(
              CGPoint(x: anchor.windowRect.midX, y: anchor.windowRect.midY))
        }
      } ?? recognized
    if anchor != nil, candidates.isEmpty {
      throw Self.staleTextReference(
        "No fresh OCR box matches the reference's observed region geometry.")
    }
    let found: ComputerTextBoxWire
    let match =
      anchor == nil
      ? NativeRecognizedText.locate(text, in: candidates)
      : NativeOCRTextMatch.locate(text, in: candidates)
    switch match {
    case .success(let box): found = box
    case .failure(let failure):
      if anchor != nil {
        switch failure {
        case .notFound:
          throw Self.staleTextReference("Fresh OCR text in the observed region no longer matches.")
        case .ambiguous:
          throw Self.staleTextReference(
            "More than one fresh OCR box matches in the observed region.")
        }
      }
      throw ComputerFailure(failure.code, failure.message)
    }
    guard let live = NativeSurfaceProbe.frame(windowId: place.windowId, pid: pid_t(place.pid)),
      surface == nil ? read.matches(size: live.size) : read.matches(frame: live)
    else {
      throw ComputerFailure(
        .staleObservation,
        "The window changed size or place while its text was read; nothing was sent. "
          + "Try the step again.")
    }
    if let anchor { try validateTextAnchor(anchor, ref: ref, place: place, frame: live) }
    let rect = found.rect.cgRect
    let start = read.screenPoint(x: Int(rect.minX), y: Int(rect.minY), windowOrigin: live.origin)
    let end = read.screenPoint(x: Int(rect.maxX), y: Int(rect.maxY), windowOrigin: live.origin)
    let shown = CGRect(x: start.x, y: start.y, width: end.x - start.x, height: end.y - start.y)
    if let geometry = NativeTargetProbe.screenGeometry(shown) {
      context.report(.located(geometry))
    }
    return .text(DriverPoint(x: shown.midX, y: shown.midY), found.text)
  }

  private func validateTextAnchor(
    _ anchor: TextAnchor, ref: TargetRefWire, place: NativeSurfaceRead, frame: CGRect
  ) throws(ComputerFailure) {
    let capture = anchor.capture
    guard let target = targets[ref.id], target.observation?.id == anchor.observationId,
      target.verificationCapture?.id == capture.id, !capture.isExpired
    else {
      throw Self.staleTextReference(
        "The OCR reference's observation or capture expired or changed.")
    }
    guard target.observed == place, capture.pid == place.pid, capture.windowId == place.windowId,
      capture.surfaceRefId == place.surfaceRefId
    else {
      throw Self.staleTextReference("The OCR reference's window or surface changed.")
    }
    guard target.latestShot[place.windowKey] == capture.id else {
      throw Self.staleTextReference("The OCR reference's capture was replaced by a newer capture.")
    }
    guard
      capture.crop == nil && place.surfaceRefId == nil
        ? capture.matches(size: frame.size) : capture.matches(frame: frame)
    else {
      throw Self.staleTextReference("The window geometry no longer matches the OCR reference.")
    }
  }

  private static func staleTextReference(_ reason: String) -> ComputerFailure {
    ComputerFailure(
      .staleObservation, reason + " Observe again and use its new ref; nothing was sent.")
  }

  private static let unreadable = ComputerFailure(
    .unsupported, "The window's text could not be read to find the step's text; nothing was sent.")
}
