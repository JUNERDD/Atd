import AICore
import Foundation
import MCP

extension PlaywrightBrowserEngine: ComputerPreviewProviding {
  func previewSource(_ ref: TargetRefWire, observation: ObservationWire) async throws
    -> ComputerPreviewSource
  {
    let (bound, instance, binding) = try await target(ref)
    let record = try currentObservation(observation.ref.id, ref: bound, refId: ref.id)
    guard let url = record.url, BrowserOrigins.allows(url, origins: binding.allowedOrigins),
      let navigation = record.navigationGeneration,
      surfaces[ref.id]?.pageId(of: observation.surfaceRefId) == record.pageId
    else { throw Self.surfaceGone }
    let validate: () async throws -> Void = { [weak self] in
      guard let self else { throw Self.surfaceGone }
      let (_, current, _) = try await self.target(ref)
      guard current.contextId == instance.contextId,
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
          previewId: previewId, engine: self, instance: instance,
          generation: record.workerGeneration)
        do {
          try Task.checkCancellation()
          let (raw, _) = try await self.call(
            instance, "preview_start",
            [
              "previewId": .string(previewId), "pageId": .string(record.pageId),
              "boundPageId": .string(bound.pageId), "expectedUrl": .string(url),
              "allowedOrigins": Self.origins(binding),
            ], timeout: .seconds(5), writes: false, pinned: record.workerGeneration)
          let reply = try self.checked(raw, "preview_start")
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
