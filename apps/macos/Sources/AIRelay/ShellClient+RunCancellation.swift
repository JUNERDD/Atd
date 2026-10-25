import AICore
import Foundation

/// The messages an exact run cancellation withdrew. The panel restores these to that task's draft.
public nonisolated struct CancelledRunMessages: Decodable, Equatable, Sendable {
  public let steering: [String]
  public let followUp: [String]

  public init(from decoder: any Decoder) throws {
    let container = try BridgeCoding.keyed(decoder, CodingKeys.self)
    steering = try container.array(.steering, of: String.self)
    followUp = try container.array(.followUp, of: String.self)
  }

  private enum CodingKeys: String, CodingKey, CaseIterable { case steering, followUp }
}

extension ShellClient {
  /// Requests cancellation of this exact run. Only the activity stream confirms it has stopped.
  public func cancelRun(taskId: String, runId: String) async throws -> CancelledRunMessages {
    guard !taskId.isEmpty, !runId.isEmpty else {
      throw ShellClientError.invalidArgument("A task id and run id are required.")
    }
    let path =
      "/v1/tasks/\(RelayPath.encodeSegment(taskId))/runs/\(RelayPath.encodeSegment(runId))/cancel"
    let response = try await send(
      "POST", path, body: Data("{}".utf8), contentType: "application/json")
    return try JSONDecoder().decode(CancelResponse.self, from: response.data).unsent
  }

  /// Only the queued messages are consumed; the control stream owns the resulting task state.
  private struct CancelResponse: Decodable {
    let unsent: CancelledRunMessages
  }
}
