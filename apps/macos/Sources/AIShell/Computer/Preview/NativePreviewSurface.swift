import AICore
import Foundation

/// Fresh surface ownership metadata, without reconciling the engine's observation state. A
/// stalled accessibility app cannot keep a preview read pending past its deadline.
enum NativePreviewSurface {
  private final class Pending {
    var continuation: CheckedContinuation<Void, any Error>?
    func finish(_ result: Result<Void, any Error>) {
      let continuation = self.continuation
      self.continuation = nil
      continuation?.resume(with: result)
    }
  }

  static func validate(_ ref: TargetRefWire, candidate: NativeSurfaceOwnership.Candidate)
    async throws
  {
    guard let native = ref.native, let rootWindow = native.windowId else {
      throw NativeEngine.changed
    }
    let pending = Pending()
    try await withCheckedThrowingContinuation { continuation in
      pending.continuation = continuation
      let work = Task {
        let valid = await NativeTargetProbe.detached {
          let facts = NativeSurfaceProbe.facts(
            pid: pid_t(native.pid), processStart: native.processStart)
          let opened = candidate.windowId.map { Set([$0]) } ?? []
          return NativeSurfaceOwnership.candidates(
            facts, rootWindowId: rootWindow,
            acted: true, opened: opened
          ).contains {
            $0.key == candidate.key && $0.signature == candidate.signature
              && $0.processStart == candidate.processStart && $0.frame == candidate.frame
              && $0.readPid == candidate.readPid && $0.readWindowId == candidate.readWindowId
          }
        }
        pending.finish(valid ? .success(()) : .failure(NativeEngine.changed))
      }
      Task {
        try? await Task.sleep(for: .seconds(2))
        pending.finish(.failure(NativeEngine.changed))
        work.cancel()
      }
    }
  }
}
