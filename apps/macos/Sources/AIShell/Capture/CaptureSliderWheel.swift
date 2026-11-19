import AppKit

/// Normalizes trackpad and physical mouse wheel events into stepless 0...1 slider units and
/// groups contiguous ticks into one undo/persistence burst.
enum CaptureSliderWheel {
  enum Step: Equatable {
    case consumedNoOp
    case delta(Double)
  }

  static func step(for event: NSEvent) -> Step {
    guard event.momentumPhase.isEmpty else { return .consumedNoOp }
    let dy = event.isDirectionInvertedFromDevice ? -event.scrollingDeltaY : event.scrollingDeltaY
    let dx = event.isDirectionInvertedFromDevice ? event.scrollingDeltaX : -event.scrollingDeltaX
    let primary = abs(dy) >= abs(dx) ? dy : dx
    guard primary != 0, primary.isFinite else { return .consumedNoOp }
    let scale =
      event.modifierFlags.intersection(.deviceIndependentFlagsMask).contains(.option) ? 0.25 : 1.0
    if event.hasPreciseScrollingDeltas {
      let unit = max(-0.25, min(0.25, Double(primary) / 240.0)) * scale
      return unit == 0 ? .consumedNoOp : .delta(unit)
    }
    let mag = abs(Double(primary))
    let raw = mag <= 0.1 ? mag * 0.1 : 0.01 * (mag / 0.1).squareRoot()
    let unit = copysign(min(raw, 0.08), Double(primary)) * scale
    return unit == 0 ? .consumedNoOp : .delta(unit)
  }
}

/// Groups contiguous scroll-wheel events into one burst UUID and fires a settle callback once
/// scrolling stops.
final class CaptureWheelBurst {
  private(set) var id = UUID()
  private var lastTimestamp: TimeInterval = -1
  private var endedPhase = false
  private var settleTask: Task<Void, Never>?

  func next(for event: NSEvent, onSettle: (@MainActor () -> Void)? = nil) -> UUID {
    if event.phase == .began || endedPhase
      || (event.phase.isEmpty && (lastTimestamp < 0 || event.timestamp - lastTimestamp > 0.5))
    {
      id = UUID()
    }
    lastTimestamp = event.timestamp
    endedPhase = (event.phase == .ended || event.phase == .cancelled)
    settleTask?.cancel()
    if let onSettle {
      settleTask = Task { @MainActor [weak self] in
        try? await Task.sleep(for: .milliseconds(520))
        guard !Task.isCancelled, let self else { return }
        self.settleTask = nil
        onSettle()
      }
    } else {
      settleTask = nil
    }
    return id
  }

  func reset() {
    settleTask?.cancel()
    settleTask = nil
    lastTimestamp = -1
    endedPhase = false
  }
}
