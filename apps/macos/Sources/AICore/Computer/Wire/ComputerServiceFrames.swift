import Foundation

/// The service → shell computer frames (`ComputerServiceFrameSchema`), decoded as closed objects
/// for ``ControlFrameDecoder``: a frame with a member the contract does not declare, or a request
/// whose operation, step, condition or locator kind is unknown, is malformed and never acted on.
enum ComputerServiceFrames {
  struct Request: Decodable {
    let request: HostRequestWire

    init(from decoder: any Decoder) throws {
      let container = try BridgeCoding.keyed(decoder, CodingKeys.self)
      try container.literal(.type, "computer.request")
      request = try container.value(.request, HostRequestWire.self)
    }

    private enum CodingKeys: String, CodingKey, CaseIterable { case type, request }
  }

  struct Cancel: Decodable {
    let cancel: ComputerCancelWire

    init(from decoder: any Decoder) throws {
      let container = try BridgeCoding.keyed(decoder, CodingKeys.self)
      try container.literal(.type, "computer.cancel")
      cancel = ComputerCancelWire(
        runId: try container.identifier(.runId),
        operationId: try container.optional(.operationId) { try container.operationId($0) },
        reason: try container.value(.reason, ComputerCancelReason.self))
    }

    private enum CodingKeys: String, CodingKey, CaseIterable {
      case type, runId, operationId, reason
    }
  }
}
