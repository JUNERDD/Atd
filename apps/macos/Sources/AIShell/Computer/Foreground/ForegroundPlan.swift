import AICore
import CoreGraphics
import Darwin

/// A step every background route refused, as the foreground fallback does it (R4, R13): the window
/// it acts in, its input in order, and how each piece reaches the target. An engine resolves it
/// without sending anything
/// (``ComputerEngine/foreground(_:on:observation:refusal:context:run:)``); ``ForegroundExecutor``
/// carries it out.
struct ForegroundPlan {
  /// The app the step's window belongs to, which comes to the front.
  let pid: pid_t
  /// The window-server id of the step's window, which must be in front, hold the app's focus and
  /// show the step's points.
  let windowId: Int
  let gestures: [ForegroundGesture]
  /// The background's refusal, which the step keeps when the foreground cannot take it either.
  let refusal: ComputerFailure
  /// Where the step shows in progress and in the live pointer.
  let geometry: ComputerGeometryWire?
  /// Sends one piece to the step's window as the engine's background route sends input: posted to
  /// the target's process, never through the HID system or the person's pointer. False when the
  /// app declined an element's focus before anything went out; any other refusal throws.
  let send: @MainActor (ForegroundGesture) async throws(ComputerFailure) -> Bool

  /// Every point the input lands on, each of which must be on the step's window and uncovered.
  var points: [CGPoint] { gestures.flatMap(\.points) }
  /// Whether an input method could compose the step's keys into text of its own.
  var composes: Bool { gestures.contains(where: \.composes) }
}

/// What a foreground step changed and put back (R6), kept apart from its result so the disturbance
/// guard reads it however the step ended: done, refused, stopped or abandoned.
final class ForegroundRecord {
  var receipt: EngineInputReceipt?
}
