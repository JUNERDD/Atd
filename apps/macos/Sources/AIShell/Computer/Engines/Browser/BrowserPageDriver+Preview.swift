import AICore
import Foundation
import MCP

/// The live monitor's preview of a browser target: the worker screencasts exactly the page the
/// observation read, while it stays that page at that navigation, on the binding's sites, in the
/// same browser and worker generation.
extension BrowserPageDriver {
  func previewSource(_ ref: TargetRefWire, observation: ObservationWire) async throws
    -> ComputerPreviewSource
  {
    let target = try await target(ref)
    let (bound, endpoint, binding) = (target.page, target.endpoint, target.binding)
    let record = try currentObservation(observation.ref.id, ref: bound, refId: ref.id)
    guard let url = record.url, BrowserOrigins.allows(url, origins: binding.allowedOrigins),
      let navigation = record.navigationGeneration,
      surfaces[ref.id]?.pageId(of: observation.surfaceRefId) == record.pageId
    else { throw Self.surfaceGone }
    let validate: () async throws -> Void = { [weak self] in
      guard let self else { throw Self.surfaceGone }
      let current = try await self.target(ref).endpoint
      guard current.contextId == endpoint.contextId,
        self.workers.generation(profileId: bound.profileId, contextId: bound.contextId)
          == record.workerGeneration,
        self.surfaces[ref.id]?.pageId(of: observation.surfaceRefId) == record.pageId
      else { throw Self.surfaceGone }
    }
    let identity = "\(ref.id):\(record.pageId):\(record.workerGeneration):\(navigation)"
    return ComputerPreviewSource(
      identity: identity, validate: validate,
      start: { [weak self] in
        guard let self else { throw Self.surfaceGone }
        try await validate()
        let previewId = UUID().uuidString.lowercased()
        let stream = BrowserPreviewStream(
          previewId: previewId, driver: self, endpoint: endpoint,
          generation: record.workerGeneration)
        do {
          try Task.checkCancellation()
          let (raw, _) = try await self.call(
            endpoint, "preview_start",
            [
              "previewId": .string(previewId), "pageId": .string(record.pageId),
              "boundPageId": .string(bound.pageId), "expectedUrl": .string(url),
              "allowedOrigins": Self.origins(binding),
            ], timeout: .seconds(5), writes: false, pinned: record.workerGeneration)
          let reply = try raw.checked("preview_start")
          guard reply.previewId == previewId else {
            throw ComputerFailure(.engineFailed, "The worker returned another preview lease.")
          }
          try Task.checkCancellation()
          try await validate()
          try Task.checkCancellation()
          return stream
        } catch {
          await stream.stop()
          throw error
        }
      })
  }
}
