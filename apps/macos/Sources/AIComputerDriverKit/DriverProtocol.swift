import Foundation

/// A request the client (the shell's `DriverClient`) sends to the driver. One Codable union
/// discriminated by `type`; the payloads are the `Driver*Request` structs. `cancel` references an
/// earlier frame's id through its own payload.
public enum DriverRequest: Equatable, Sendable {
  case hello(DriverHelloRequest)
  case probe(DriverProbeRequest)
  case prepare(DriverPrepareRequest)
  case release(DriverReleaseRequest)
  case snapshot(DriverSnapshotRequest)
  case perform(DriverPerformRequest)
  case capture(DriverCaptureRequest)
  case cancel(DriverCancelRequest)
}

extension DriverRequest: Codable {
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
    case .hello: self = .hello(try c.decode(DriverHelloRequest.self, forKey: .payload))
    case .probe: self = .probe(try c.decode(DriverProbeRequest.self, forKey: .payload))
    case .prepare: self = .prepare(try c.decode(DriverPrepareRequest.self, forKey: .payload))
    case .release: self = .release(try c.decode(DriverReleaseRequest.self, forKey: .payload))
    case .snapshot: self = .snapshot(try c.decode(DriverSnapshotRequest.self, forKey: .payload))
    case .perform: self = .perform(try c.decode(DriverPerformRequest.self, forKey: .payload))
    case .capture: self = .capture(try c.decode(DriverCaptureRequest.self, forKey: .payload))
    case .cancel: self = .cancel(try c.decode(DriverCancelRequest.self, forKey: .payload))
    }
  }
}

/// A request frame: the client's monotonic `id` plus the request. The driver's response frame
/// echoes the same `id`; the client correlates by it.
public struct DriverRequestFrame: Codable, Equatable, Sendable {
  public var id: Int
  public var request: DriverRequest

  public init(id: Int, request: DriverRequest) {
    self.id = id
    self.request = request
  }
}
