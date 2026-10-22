import AICore
import AppKit
import OSLog

/// WindowServer metadata only. No titles, content or screenshots enter failure diagnostics.
struct ForegroundWindowSnapshot: Encodable {
  struct Window: Encodable {
    let number: Int
    let pid: pid_t
    let order: Int
    let bounds: CGRect
    let layer: Int?
    let alpha: Double

    var hitWindow: ForegroundHitTest.Window {
      .init(number: number, pid: pid, bounds: bounds, visible: alpha > 0)
    }
  }

  let capturedAt: TimeInterval
  let frontmost: pid_t?
  let windows: [Window]

  static func read() -> Self {
    let capturedAt = Date().timeIntervalSince1970
    let frontmost = NSWorkspace.shared.frontmostApplication?.processIdentifier
    let list =
      CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID)
      as? [[String: Any]] ?? []
    let windows = list.enumerated().compactMap { order, info -> Window? in
      guard let number = info[kCGWindowNumber as String] as? Int,
        let pid = info[kCGWindowOwnerPID as String] as? pid_t,
        let frame = info[kCGWindowBounds as String] as? NSDictionary,
        let bounds = CGRect(dictionaryRepresentation: frame as CFDictionary)
      else { return nil }
      return Window(
        number: number, pid: pid, order: order, bounds: bounds,
        layer: info[kCGWindowLayer as String] as? Int,
        alpha: info[kCGWindowAlpha as String] as? Double ?? 1)
    }
    return Self(capturedAt: capturedAt, frontmost: frontmost, windows: windows)
  }

  /// Retains global order indices, but logs only the target and the front app's first window.
  func summary(target pid: pid_t) -> Self {
    let front = windows.first { $0.pid == frontmost }?.number
    return Self(
      capturedAt: capturedAt, frontmost: frontmost,
      windows: windows.filter { $0.pid == pid || $0.number == front })
  }
}

/// Buffers the bounded foreground attempt. Failures and the first rectangle/system-hit
/// disagreement are emitted as short correlated records.
final class ForegroundDiagnostics {
  struct Raise: Encodable {
    let stage: String
    let windowId: Int
    let succeeded: Bool
    let before: ForegroundWindowSnapshot
    let after: ForegroundWindowSnapshot
  }

  struct Covered: Encodable {
    let stage: String
    let sample: Int
    let capturedAt: TimeInterval
    let frontmost: pid_t?
    let point: CGPoint
    let target: ForegroundWindowSnapshot.Window?
    let blocker: ForegroundWindowSnapshot.Window?
    let osHitWindowId: Int?
    let osHit: ForegroundWindowSnapshot.Window?
  }

  private struct Failure: Encodable {
    let runId: String?
    let operationId: String?
    let targetPid: pid_t
    let targetWindowId: Int
    let code: String
    let reason: String?
    let sent: Bool
    let stage: String
    let readinessSamples: Int
    let coveredSamples: Int
  }

  private struct Detail<Value: Encodable>: Encodable {
    let runId: String?
    let operationId: String?
    let value: Value
  }

  private struct RaiseSample: Encodable {
    let index: Int
    let stage: String
    let windowId: Int
    let succeeded: Bool
    let phase: String
    let snapshot: ForegroundWindowSnapshot
  }

  private struct CoveredBlocker: Encodable {
    let stage: String
    let sample: Int
    let capturedAt: TimeInterval
    let frontmost: pid_t?
    let point: CGPoint
    let blocker: ForegroundWindowSnapshot.Window?
    let osHitWindowId: Int?
  }

  private static let log = Logger(subsystem: "com.junerdd.ai", category: "computer-input")
  private var raises: [Raise] = []
  private var stage = "beforeActivation"
  private var readinessSamples = 0
  private var coveredSamples = 0
  private var firstCovered: Covered?
  private var lastCovered: Covered?
  private var firstAcceptedHit: Covered?

  func raised(
    stage: String, windowId: Int, succeeded: Bool,
    before: ForegroundWindowSnapshot, after: ForegroundWindowSnapshot
  ) {
    raises.append(
      Raise(stage: stage, windowId: windowId, succeeded: succeeded, before: before, after: after))
  }

  func checking(_ stage: String) {
    self.stage = stage
    readinessSamples += 1
  }

  func assessed(
    _ assessment: ForegroundHitTest.Assessment, point: CGPoint, target: Int,
    scene: ForegroundWindowSnapshot, hitWindowId: Int?
  ) {
    let blocker = scene.windows.first { $0.number == assessment.blocker?.number }
    let sample = Covered(
      stage: stage, sample: readinessSamples, capturedAt: scene.capturedAt,
      frontmost: scene.frontmost, point: point,
      target: scene.windows.first { $0.number == target }, blocker: blocker,
      osHitWindowId: hitWindowId, osHit: scene.windows.first { $0.number == hitWindowId })
    if assessment.verdict == .reaches, blocker != nil, firstAcceptedHit == nil {
      firstAcceptedHit = sample
    }
    guard assessment.verdict == .covered else { return }
    coveredSamples += 1
    if firstCovered == nil { firstCovered = sample }
    lastCovered = sample
  }

  func failed(_ failure: ComputerFailure, plan: ForegroundPlan, owner: ClaimOwner, sent: Bool) {
    let operation: ComputerOperation? = if case .computer(let value) = owner { value } else { nil }
    let payload = Failure(
      runId: operation?.runId, operationId: operation?.operationId,
      targetPid: plan.pid, targetWindowId: plan.windowId,
      code: failure.code.rawValue, reason: failure.reason?.rawValue, sent: sent, stage: stage,
      readinessSamples: readinessSamples, coveredSamples: coveredSamples)
    Self.emit("header", payload)
    // Window arrays can grow without a bound. Keep each window in its own correlated record.
    for (index, raise) in raises.enumerated() {
      for (phase, snapshot) in [("before", raise.before), ("after", raise.after)] {
        let windows: [[ForegroundWindowSnapshot.Window]] =
          snapshot.windows.isEmpty ? [[]] : snapshot.windows.map { [$0] }
        for window in windows {
          detail(
            "raise",
            RaiseSample(
              index: index, stage: raise.stage, windowId: raise.windowId,
              succeeded: raise.succeeded, phase: phase,
              snapshot: ForegroundWindowSnapshot(
                capturedAt: snapshot.capturedAt, frontmost: snapshot.frontmost, windows: window)),
            operation: operation)
        }
      }
    }
    for (name, sample) in [("firstCovered", firstCovered), ("lastCovered", lastCovered)] {
      guard let sample else { continue }
      hitDetail(name, sample, operation: operation)
    }
  }

  func completed(owner: ClaimOwner) {
    guard let sample = firstAcceptedHit else { return }
    let operation: ComputerOperation? = if case .computer(let value) = owner { value } else { nil }
    hitDetail("acceptedHit", sample, operation: operation)
  }

  private func hitDetail(_ name: String, _ sample: Covered, operation: ComputerOperation?) {
    detail(
      name,
      CoveredBlocker(
        stage: sample.stage, sample: sample.sample, capturedAt: sample.capturedAt,
        frontmost: sample.frontmost, point: sample.point, blocker: sample.blocker,
        osHitWindowId: sample.osHitWindowId), operation: operation)
    if let target = sample.target { detail("\(name)Target", target, operation: operation) }
    if let hit = sample.osHit { detail("\(name)OSHit", hit, operation: operation) }
  }

  private func detail<Value: Encodable>(
    _ name: String, _ value: Value, operation: ComputerOperation?
  ) {
    Self.emit(
      name, Detail(runId: operation?.runId, operationId: operation?.operationId, value: value))
  }

  private static func emit<Value: Encodable>(_ name: String, _ value: Value) {
    guard let data = try? JSONEncoder().encode(value),
      let json = String(data: data, encoding: .utf8)
    else { return }
    log.notice("Foreground diagnostic \(name, privacy: .public): \(json, privacy: .public)")
  }
}
