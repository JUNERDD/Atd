import Foundation

/// The desktop capabilities the shell serves (`DesktopCapabilitySchema`).
public enum DesktopCapability: String, Codable, CaseIterable, Sendable {
  case filePick = "file.pick"
  case fileSave = "file.save"
  case selectionRead = "selection.read"
  case clipboardRead = "clipboard.read"
  case clipboardWrite = "clipboard.write"
}

/// A pending capability request (`CapabilityRequestSchema`). The result is matched by
/// `id` + `revision`, independent of the connection that registered.
public struct CapabilityRequest: Codable, Equatable, Sendable {
  public var id: String
  public var revision: Int
  public var capability: DesktopCapability
  /// `unknown` in the contract; absent on the wire when the service's value was undefined.
  public var input: JSONValue
  public var taskId: String
  public var runId: String
  public var executionId: String
  public var operationId: String
  public var expiresAt: String
  public var createdAt: String

  public init(from decoder: any Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    id = try container.decode(String.self, forKey: .id)
    revision = try container.decode(Int.self, forKey: .revision)
    capability = try container.decode(DesktopCapability.self, forKey: .capability)
    input = try container.decodeIfPresent(JSONValue.self, forKey: .input) ?? .null
    taskId = try container.decode(String.self, forKey: .taskId)
    runId = try container.decode(String.self, forKey: .runId)
    executionId = try container.decode(String.self, forKey: .executionId)
    operationId = try container.decode(String.self, forKey: .operationId)
    expiresAt = try container.decode(String.self, forKey: .expiresAt)
    createdAt = try container.decode(String.self, forKey: .createdAt)
  }
}

/// The only service frames the shell's control stream acts on. Task events, `summaries`,
/// `resumed`, `invalidate` of any scope but `widgets`, and anything newer are dropped: the shell
/// holds no task state.
public enum ControlFrame: Equatable, Sendable {
  /// Menu bar counts: root tasks running (queued, running, stopping) and needing attention.
  case status(running: Int, attention: Int)
  case capabilityRequest(CapabilityRequest)
  /// Registration accepted; the id is the service's name for this connection.
  case capabilityRegistered(clientId: String)
  /// The service's answer to a `capability.result`.
  case capabilityAck(requestId: String, ok: Bool, error: String?)
  case pong
  /// A frame the service could not handle (for example a refused registration).
  case error(String)
  /// `invalidate` with scope `widgets` (`InvalidateFrameSchema`): the widget catalog, a snapshot
  /// or the launcher's app list changed, so the shell pulls `GET /v1/widgets/snapshots` again.
  case widgetsInvalidated
}

public enum ControlFrameDecoding: Equatable, Sendable {
  case frame(ControlFrame)
  /// Not one of the decoded types (or an `invalidate` of another scope); carries the type when
  /// there is one, for logging.
  case ignored(type: String?)
  /// One of the decoded types in a shape the contract does not allow.
  case malformed(type: String)
}

public enum ControlFrameDecoder {
  public static func decode(_ text: String) -> ControlFrameDecoding {
    let data = Data(text.utf8)
    let decoder = JSONDecoder()
    guard let envelope = try? decoder.decode(Envelope.self, from: data) else {
      return .ignored(type: nil)
    }
    let frame: ControlFrame?
    switch envelope.type {
    case "status":
      frame = (try? decoder.decode(Status.self, from: data)).flatMap { status in
        status.running >= 0 && status.attention >= 0
          ? .status(running: status.running, attention: status.attention) : nil
      }
    case "capability.request":
      frame = (try? decoder.decode(Request.self, from: data)).map { .capabilityRequest($0.request) }
    case "capability.registered":
      frame = (try? decoder.decode(Registered.self, from: data)).map {
        .capabilityRegistered(clientId: $0.clientId)
      }
    case "capability.ack":
      frame = (try? decoder.decode(Ack.self, from: data)).map {
        .capabilityAck(requestId: $0.requestId, ok: $0.ok, error: $0.error)
      }
    case "pong":
      frame = .pong
    case "error":
      frame = (try? decoder.decode(Failure.self, from: data)).map { .error($0.error) }
    case "invalidate":
      // Other scopes concern the renderer's data, which the shell does not hold.
      guard (try? decoder.decode(Invalidate.self, from: data))?.scope == "widgets" else {
        return .ignored(type: envelope.type)
      }
      frame = .widgetsInvalidated
    default:
      return .ignored(type: envelope.type)
    }
    return frame.map(ControlFrameDecoding.frame) ?? .malformed(type: envelope.type)
  }

  private struct Envelope: Decodable { let type: String }
  private struct Status: Decodable {
    let running: Int
    let attention: Int
  }
  private struct Request: Decodable { let request: CapabilityRequest }
  private struct Registered: Decodable { let clientId: String }
  private struct Ack: Decodable {
    let requestId: String
    let ok: Bool
    let error: String?
  }
  private struct Failure: Decodable { let error: String }
  private struct Invalidate: Decodable { let scope: String }
}
