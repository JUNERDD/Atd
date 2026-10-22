import AICore
import Foundation
import OSLog

/// Retains results and samples restoration already produced. Logging never reads the desktop
/// again or changes the repair decision, and successful restorations produce no extra records.
final class ForegroundRestorationDiagnostics {
  private struct Result: Encodable {
    let front: String
    let activationSucceeded: Bool?
    let raise: ForegroundAX.RaiseResult?
    let waitCancelled: Bool
  }

  private struct Scene: Encodable {
    let stage: String
    let capturedAt: TimeInterval
    let frontmost: pid_t?
    let recordedWindow: Int?
    let personWindow: Int?
    let targetAbove: Bool
    let omittedWindows: Int
  }

  private struct Record<Value: Encodable>: Encodable {
    let runId: String
    let operationId: String
    let value: Value
  }

  private struct WindowRecord: Encodable {
    let stage: String
    let window: DisturbanceSnapshot.Window
  }

  private static let log = Logger(subsystem: "com.junerdd.ai", category: "computer-input")
  private let operation: ComputerOperation
  private let before: DisturbanceSnapshot
  private let target: Set<pid_t>
  private var latest: (snapshot: DisturbanceSnapshot, stage: String)?
  var activationSucceeded: Bool?
  var raise: ForegroundAX.RaiseResult?
  var waitCancelled = false

  init(operation: ComputerOperation, before: DisturbanceSnapshot, target: Set<pid_t>) {
    self.operation = operation
    self.before = before
    self.target = target
  }

  func sample(_ snapshot: DisturbanceSnapshot, stage: String) {
    latest = (snapshot, stage)
  }

  func finished(_ restoration: ForegroundRestoration) {
    guard !restoration.putBack else { return }
    emit(
      "result",
      Result(
        front: restoration.front.rawValue, activationSucceeded: activationSucceeded, raise: raise,
        waitCancelled: waitCancelled))
    emitScene(before, stage: "beforeRepair")
    if let latest { emitScene(latest.snapshot, stage: latest.stage) }
  }

  private func emitScene(_ snapshot: DisturbanceSnapshot, stage: String) {
    let scene = snapshot.diagnostic(target: target)
    // Keep the reference window and at most seven target windows, in separate short records.
    // The predicate remains complete even when a large app's window details are truncated.
    let reference = scene.windows.first { $0.number == scene.personWindow }
    let windows =
      (reference.map { [$0] } ?? [])
      + scene.windows.filter { $0.number != scene.personWindow }.prefix(7)
    emit(
      "scene",
      Scene(
        stage: stage, capturedAt: scene.capturedAt, frontmost: scene.frontmost,
        recordedWindow: before.personWindow, personWindow: scene.personWindow,
        targetAbove: scene.targetAbove, omittedWindows: scene.windows.count - windows.count))
    for window in windows { emit("window", WindowRecord(stage: stage, window: window)) }
  }

  private func emit<Value: Encodable>(_ name: String, _ value: Value) {
    guard
      let data = try? JSONEncoder().encode(
        Record(runId: operation.runId, operationId: operation.operationId, value: value)),
      let json = String(data: data, encoding: .utf8)
    else { return }
    Self.log.notice("Restoration diagnostic \(name, privacy: .public): \(json, privacy: .public)")
  }
}
