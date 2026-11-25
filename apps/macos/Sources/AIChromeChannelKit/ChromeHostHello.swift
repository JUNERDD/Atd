import Foundation

/// `host.hello {origin, pid, ppid, browserPath}`: the one frame the native host writes itself,
/// first on its socket, before it pipes anything of Chrome's. `origin` is the caller origin Chrome
/// passed the host (`chrome-extension://<id>/`), `ppid` the browser process that started it and
/// `browserPath` that process's executable. The shell trusts these only after its own peer check
/// (same user, the embedded host binary), and re-reads `ppid`'s executable itself.
public struct ChromeHostHello: Codable, Equatable, Sendable {
  public let origin: String
  public let pid: Int32
  public let ppid: Int32
  public let browserPath: String

  public init(origin: String, pid: Int32, ppid: Int32, browserPath: String) {
    self.origin = origin
    self.pid = pid
    self.ppid = ppid
    self.browserPath = browserPath
  }

  public init(from decoder: any Decoder) throws {
    let container = try ChromeChannelCoding.object(decoder, CodingKeys.self)
    try container.version(.v)
    guard try container.decode(String.self, forKey: .t) == "host.hello" else {
      throw DecodingError.dataCorruptedError(
        forKey: .t, in: container, debugDescription: "The first frame must be host.hello.")
    }
    origin = try container.text(.origin, minLength: 1, maxLength: 256)
    pid = Int32(try container.whole(.pid, minimum: 1, maximum: Int(Int32.max)))
    ppid = Int32(try container.whole(.ppid, minimum: 1, maximum: Int(Int32.max)))
    browserPath = try container.text(.browserPath, maxLength: 4096)
  }

  public func encode(to encoder: any Encoder) throws {
    var container = encoder.container(keyedBy: CodingKeys.self)
    try container.encode(ChromeChannelProtocol.version, forKey: .v)
    try container.encode("host.hello", forKey: .t)
    try container.encode(origin, forKey: .origin)
    try container.encode(pid, forKey: .pid)
    try container.encode(ppid, forKey: .ppid)
    try container.encode(browserPath, forKey: .browserPath)
  }

  private enum CodingKeys: String, CodingKey {
    case v, t, origin, pid, ppid, browserPath
  }
}
