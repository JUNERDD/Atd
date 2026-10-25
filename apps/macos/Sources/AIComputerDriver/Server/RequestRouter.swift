import AIComputerDriverKit
import Foundation

/// Maps one decoded request to its response frame by calling the engine. Pure dispatch: all
/// threading, framing and liveness live in `DriverServer`. A thrown `DriverFailure` becomes a
/// failure response with the same id; the host correlates by id.
enum RequestRouter {
  /// The target pid a request acts on, or nil for control requests (`hello`, `cancel`) that run
  /// off any single target's executor.
  static func targetPid(_ request: DriverRequest) -> pid_t? {
    switch request {
    case .hello, .cancel: return nil
    case .probe(let r): return pid_t(r.target.pid)
    case .prepare(let r): return pid_t(r.target.pid)
    case .release(let r): return pid_t(r.target.pid)
    case .snapshot(let r): return pid_t(r.target.pid)
    case .perform(let r): return pid_t(r.target.pid)
    case .capture(let r): return pid_t(r.target.pid)
    }
  }

  static func respond(_ frame: DriverRequestFrame, engine: DriverEngine) -> DriverResponseFrame {
    do {
      switch frame.request {
      case .hello:
        return DriverResponseFrame(id: frame.id, result: .hello(engine.hello()))
      case .probe(let request):
        return DriverResponseFrame(id: frame.id, result: .probe(try engine.probe(request)))
      case .prepare(let request):
        return DriverResponseFrame(id: frame.id, result: .prepare(try engine.prepare(request)))
      case .release(let request):
        return DriverResponseFrame(id: frame.id, result: .release(engine.release(request)))
      case .snapshot(let request):
        return DriverResponseFrame(id: frame.id, result: .snapshot(try engine.snapshot(request)))
      case .perform(let request):
        switch engine.perform(request) {
        case .success(let result):
          return DriverResponseFrame(id: frame.id, result: .perform(result))
        case .failure(let failure): return DriverResponseFrame(id: frame.id, failure: failure)
        }
      case .capture(let request):
        return DriverResponseFrame(id: frame.id, result: .capture(try engine.capture(request)))
      case .cancel:
        // A per-request deadline already bounds each primitive; a stuck AX action is abandoned on
        // its own worker and the pid stays busy until it returns. Cancel is acknowledged so the
        // host can stop waiting; it does not forcibly interrupt a synchronous system call.
        return DriverResponseFrame(id: frame.id, result: .cancel(DriverAck()))
      }
    } catch let failure as DriverFailure {
      return DriverResponseFrame(id: frame.id, failure: failure)
    } catch {
      return DriverResponseFrame(
        id: frame.id,
        failure: DriverFailure(code: .internalError, message: String(describing: error)))
    }
  }
}
