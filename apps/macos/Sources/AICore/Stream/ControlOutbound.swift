import Foundation

/// The result of a capability request (`CapabilityResultSchema`).
public struct CapabilityResult: Encodable, Equatable, Sendable {
  public static let maxErrorLength = 2000

  public let requestId: String
  public let revision: Int
  public let ok: Bool
  public let value: JSONValue?
  public let error: String?

  public static func success(_ request: CapabilityRequest, value: JSONValue) -> CapabilityResult {
    CapabilityResult(
      requestId: request.id, revision: request.revision, ok: true, value: value, error: nil)
  }

  /// The message is cut to the contract's 2000 characters: a longer one would make the
  /// service refuse the result and leave the request waiting until it expires.
  public static func failure(_ request: CapabilityRequest, error: String) -> CapabilityResult {
    CapabilityResult(
      requestId: request.id, revision: request.revision, ok: false, value: nil,
      error: String(error.prefix(maxErrorLength)))
  }
}

/// The frames the shell's control stream sends, and its timing. This is the one stream the
/// shell reconnects itself; the page's virtual sockets are never reconnected by Swift.
public enum ControlStream {
  /// The service's capability lease (`LEASE_MS`); a registration not refreshed by a ping or
  /// a result within it stops receiving requests.
  public static let lease: Duration = .seconds(300)
  /// Ping cadence, well inside the lease so one lost ping does not lapse it.
  public static let pingInterval: Duration = .seconds(60)

  /// Sent first on every connection. Before a subscribe the service sends the connection
  /// every task event; an empty `taskIds` receives none, and `status` asks for the menu bar
  /// counts. The shell tracks no epoch or seq, so it always subscribes from zero.
  public static func subscribe() -> String {
    fixed(Subscribe(type: "subscribe", epoch: 0, seq: 0, taskIds: [], status: true))
  }

  public static func register(_ capabilities: [DesktopCapability]) -> String {
    fixed(Register(type: "capability.register", capabilities: capabilities))
  }

  /// Throws only for a value JSON cannot carry (a non-finite number).
  public static func result(_ result: CapabilityResult) throws -> String {
    try encode(Result(type: "capability.result", result: result))
  }

  public static func ping() -> String { fixed(Ping(type: "ping")) }

  /// Reconnect delay after `failures` consecutive failed connections: 250 ms doubling to
  /// 5 s, the same curve as the page's stream client.
  public static func reconnectDelay(failures: Int) -> Duration {
    .milliseconds(min(250 << min(max(failures, 0), 5), 5000))
  }

  private struct Subscribe: Encodable {
    let type: String
    let epoch: Int
    let seq: Int
    let taskIds: [String]
    let status: Bool
  }
  private struct Register: Encodable {
    let type: String
    let capabilities: [DesktopCapability]
  }
  private struct Result: Encodable {
    let type: String
    let result: CapabilityResult
  }
  private struct Ping: Encodable { let type: String }

  private static func encode(_ value: some Encodable) throws -> String {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
    return String(decoding: try encoder.encode(value), as: UTF8.self)
  }

  /// Frames made only of strings, integers and booleans, which always encode.
  private static func fixed(_ value: some Encodable) -> String {
    try! encode(value)
  }
}
