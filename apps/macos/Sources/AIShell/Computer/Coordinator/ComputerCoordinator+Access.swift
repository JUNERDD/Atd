import AICore
import Foundation

extension ComputerCoordinator {
  func prepareAccess(_ request: HostRequestWire, target: ComputerAccessTargetWire) async
    -> HostReplyWire
  {
    guard !request.envelope.unattended, let accessPreparer else {
      return .failed(request, .unsupported, "New access requires an attended task.")
    }
    do throws(ComputerFailure) {
      let content = try await accessPreparer.resolve(target)
      guard accessIsLive(request) else {
        return .failed(request, .cancelled, "The access request ended.")
      }
      return .ok(request, .accessCandidate(content))
    } catch { return HostReplyWire(identity: request.identity, outcome: .failed(error.wire)) }
  }

  /// The service already applied manual, automatic or full approval to this exact binding.
  /// The host still owns system permissions, identity checks, interruption and cancellation. The
  /// target opens in the background; the reply says whether an app became active anyway.
  func openAccess(_ request: HostRequestWire, access: OpenComputerAccessWire) async -> HostReplyWire
  {
    guard !request.envelope.unattended, let accessPreparer, accessIsLive(request) else {
      return .failed(request, .cancelled, "The access request is not live and attended.")
    }
    let runId = request.envelope.runId
    do throws(ComputerFailure) {
      let activated = try await accessPreparer.open(access, runId: runId)
      guard accessIsLive(request) else {
        await accessPreparer.finish(runId: runId)
        return .failed(request, .cancelled, "The access request ended while the target opened.")
      }
      return .ok(request, .accessOpened(activated: activated))
    } catch { return HostReplyWire(identity: request.identity, outcome: .failed(error.wire)) }
  }

  private func accessIsLive(_ request: HostRequestWire) -> Bool {
    !stopping && deadline(of: request) > .now
      && !cancelled.isCancelled(
        runId: request.envelope.runId, operationId: request.envelope.operationId)
  }
}
