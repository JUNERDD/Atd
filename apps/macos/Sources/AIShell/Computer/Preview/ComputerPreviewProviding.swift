import AICore
import Foundation

/// Preview pixels have their own lifetime and never become action captures or observations.
nonisolated struct ComputerPreviewFrame: Sendable {
  let sequence: Int
  let capturedAt: Date
  let width: Int
  let height: Int
  let data: Data
}

protocol ComputerPreviewStream: AnyObject {
  var nativeFrames: NativeCaptureFrames? { get }
  func latest() async throws -> ComputerPreviewFrame?
  func stop() async
}

extension ComputerPreviewStream {
  var nativeFrames: NativeCaptureFrames? { nil }
}

struct ComputerPreviewSource {
  let identity: String
  let validate: () async throws -> Void
  let start: () async throws -> any ComputerPreviewStream
}

protocol ComputerPreviewProviding {
  func previewSource(_ ref: TargetRefWire, observation: ObservationWire) async throws
    -> ComputerPreviewSource
}
