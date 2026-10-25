import Foundation

/// The successful result of a request. One Codable union discriminated by `type`; each case's
/// payload is the matching `Driver*Result`/`DriverHello`/`DriverProbeResult`/`DriverAck`.
public enum DriverResult: Equatable, Sendable {
  case hello(DriverHello)
  case probe(DriverProbeResult)
  case prepare(DriverPrepareResult)
  case release(DriverAck)
  case snapshot(DriverSnapshotResult)
  case perform(DriverPerformResult)
  case capture(DriverCaptureResult)
  case cancel(DriverAck)
}

extension DriverResult: Codable {
  private enum CodingKeys: String, CodingKey { case type, payload }
  private enum Kind: String, Codable {
    case hello, probe, prepare, release, snapshot, perform, capture, cancel
  }

  public func encode(to encoder: any Encoder) throws {
    var c = encoder.container(keyedBy: CodingKeys.self)
    switch self {
    case .hello(let p):
      try c.encode(Kind.hello, forKey: .type)
      try c.encode(p, forKey: .payload)
    case .probe(let p):
      try c.encode(Kind.probe, forKey: .type)
      try c.encode(p, forKey: .payload)
    case .prepare(let p):
      try c.encode(Kind.prepare, forKey: .type)
      try c.encode(p, forKey: .payload)
    case .release(let p):
      try c.encode(Kind.release, forKey: .type)
      try c.encode(p, forKey: .payload)
    case .snapshot(let p):
      try c.encode(Kind.snapshot, forKey: .type)
      try c.encode(p, forKey: .payload)
    case .perform(let p):
      try c.encode(Kind.perform, forKey: .type)
      try c.encode(p, forKey: .payload)
    case .capture(let p):
      try c.encode(Kind.capture, forKey: .type)
      try c.encode(p, forKey: .payload)
    case .cancel(let p):
      try c.encode(Kind.cancel, forKey: .type)
      try c.encode(p, forKey: .payload)
    }
  }

  public init(from decoder: any Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    switch try c.decode(Kind.self, forKey: .type) {
    case .hello: self = .hello(try c.decode(DriverHello.self, forKey: .payload))
    case .probe: self = .probe(try c.decode(DriverProbeResult.self, forKey: .payload))
    case .prepare: self = .prepare(try c.decode(DriverPrepareResult.self, forKey: .payload))
    case .release: self = .release(try c.decode(DriverAck.self, forKey: .payload))
    case .snapshot: self = .snapshot(try c.decode(DriverSnapshotResult.self, forKey: .payload))
    case .perform: self = .perform(try c.decode(DriverPerformResult.self, forKey: .payload))
    case .capture: self = .capture(try c.decode(DriverCaptureResult.self, forKey: .payload))
    case .cancel: self = .cancel(try c.decode(DriverAck.self, forKey: .payload))
    }
  }
}

/// A response frame: the `id` of the request it answers plus either a result or a failure. The
/// driver sends exactly one per request frame (after any events).
public struct DriverResponseFrame: Codable, Equatable, Sendable {
  public var id: Int
  public var result: DriverResult?
  public var failure: DriverFailure?

  public init(id: Int, result: DriverResult) {
    self.id = id
    self.result = result
    self.failure = nil
  }

  public init(id: Int, failure: DriverFailure) {
    self.id = id
    self.result = nil
    self.failure = failure
  }
}

/// An unsolicited notification from the driver, not tied to a request id. `ready` is sent once at
/// startup carrying the same `DriverHello` a `hello` request returns, so the client learns the
/// protocol version and capabilities without a round trip. Logs go to stderr, not events.
public enum DriverEvent: Equatable, Sendable {
  case ready(DriverHello)
}

extension DriverEvent: Codable {
  private enum CodingKeys: String, CodingKey { case type, payload }
  private enum Kind: String, Codable { case ready }

  public func encode(to encoder: any Encoder) throws {
    var c = encoder.container(keyedBy: CodingKeys.self)
    switch self {
    case .ready(let p):
      try c.encode(Kind.ready, forKey: .type)
      try c.encode(p, forKey: .payload)
    }
  }

  public init(from decoder: any Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    switch try c.decode(Kind.self, forKey: .type) {
    case .ready: self = .ready(try c.decode(DriverHello.self, forKey: .payload))
    }
  }
}

/// Everything the driver writes to stdout: either a response to a request or an event. The client
/// reads one stream and dispatches on `kind`.
public enum DriverOutgoing: Equatable, Sendable {
  case response(DriverResponseFrame)
  case event(DriverEvent)
}

extension DriverOutgoing: Codable {
  private enum CodingKeys: String, CodingKey { case kind, response, event }
  private enum Kind: String, Codable { case response, event }

  public func encode(to encoder: any Encoder) throws {
    var c = encoder.container(keyedBy: CodingKeys.self)
    switch self {
    case .response(let frame):
      try c.encode(Kind.response, forKey: .kind)
      try c.encode(frame, forKey: .response)
    case .event(let event):
      try c.encode(Kind.event, forKey: .kind)
      try c.encode(event, forKey: .event)
    }
  }

  public init(from decoder: any Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    switch try c.decode(Kind.self, forKey: .kind) {
    case .response: self = .response(try c.decode(DriverResponseFrame.self, forKey: .response))
    case .event: self = .event(try c.decode(DriverEvent.self, forKey: .event))
    }
  }
}
