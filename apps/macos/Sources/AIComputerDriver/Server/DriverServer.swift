import AIComputerDriverKit
import Foundation

/// The driver's top-level loop. Reads length-prefixed request frames from stdin, runs each on the
/// right executor (one serial queue per target pid; a shared control queue for `hello`/`cancel`),
/// and writes response frames to stdout. stdin closing is the parent-liveness signal: the loop
/// ends, pinned window state is restored, and the process exits (plan §4.1). Request handling is
/// wrapped in `beginActivity(.userInitiated)` so background throttling never adds latency to a
/// live action.
final class DriverServer: @unchecked Sendable {
  private let transport: FrameTransport
  private let engine: DriverEngine
  private let control = DispatchQueue(label: "atd.computer.driver.control")

  init(transport: FrameTransport = FrameTransport(), generation: Int) {
    self.transport = transport
    self.engine = DriverEngine(generation: generation)
  }

  /// Run until stdin closes. Blocks the calling thread (the process main thread).
  func run() {
    // Announce capabilities up front so the client need not round-trip a `hello` first.
    transport.write(.event(.ready(engine.hello())))
    while let frame = transport.readFrame() {
      dispatch(frame)
    }
    OcclusionKeepAlive.shared.releaseAll()
  }

  private func dispatch(_ frame: DriverRequestFrame) {
    guard let pid = RequestRouter.targetPid(frame.request) else {
      control.async { [self] in respond(frame) }
      return
    }
    // A pid left busy by a prior stuck AX action cannot take another request until it returns;
    // answer promptly rather than piling a second blocking call on the same target.
    if engine.executors.isBusy(pid) {
      control.async { [self] in
        transport.write(
          .response(
            DriverResponseFrame(
              id: frame.id,
              failure: DriverFailure(
                code: .cancelled, message: "target pid is busy with a prior stuck action"))))
      }
      return
    }
    engine.executors.queue(for: pid).async { [self] in respond(frame) }
  }

  private func respond(_ frame: DriverRequestFrame) {
    let activity = ProcessInfo.processInfo.beginActivity(
      options: [.userInitiated], reason: "computer-use request")
    defer { ProcessInfo.processInfo.endActivity(activity) }
    transport.write(.response(RequestRouter.respond(frame, engine: engine)))
  }
}

/// Start the driver server. The CLI entry point calls this; the generation marker (stamped into
/// every synthetic event) is read from the environment so the shell can raise it across driver
/// restarts, else defaults to 1.
public func runComputerDriver() {
  let generation =
    ProcessInfo.processInfo.environment["AI_COMPUTER_DRIVER_GENERATION"]
    .flatMap(Int.init) ?? 1
  DriverServer(generation: generation).run()
}
