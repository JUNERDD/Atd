import Foundation

/// The `com.apple.quarantine` attribute on every file the shell writes from a download, so
/// Gatekeeper checks it when it is opened, as it does for a browser's downloads. The app is not
/// sandboxed and does not set `LSFileQuarantineEnabled`, so nothing marks its files otherwise.
public struct DownloadQuarantine: Equatable, Sendable {
  /// The app named in Gatekeeper's prompt.
  public let agentName: String
  public let agentBundleIdentifier: String?

  public init(agentName: String, agentBundleIdentifier: String?) {
    self.agentName = agentName
    self.agentBundleIdentifier = agentBundleIdentifier
  }

  /// The running app's name and bundle identifier.
  public static var app: DownloadQuarantine {
    let bundle = Bundle.main
    let name = bundle.object(forInfoDictionaryKey: "CFBundleName") as? String
    return DownloadQuarantine(
      agentName: name.flatMap { $0.isEmpty ? nil : $0 } ?? "Atd",
      agentBundleIdentifier: bundle.bundleIdentifier)
  }

  /// `URLResourceValues.quarantineProperties`: a download of another kind than a web page's
  /// (the service is not a website). Launch Services adds the time stamp and event identifier.
  public var properties: [String: String] {
    var properties = [
      kLSQuarantineAgentNameKey as String: agentName,
      kLSQuarantineTypeKey as String: kLSQuarantineTypeOtherDownload as String,
    ]
    if let agentBundleIdentifier {
      properties[kLSQuarantineAgentBundleIdentifierKey as String] = agentBundleIdentifier
    }
    return properties
  }

  /// Writes `data` atomically to `url` and quarantines it. A file that cannot be quarantined
  /// is removed and the error thrown: an unmarked download must not be left to open.
  public func write(_ data: Data, to url: URL) throws {
    try data.write(to: url, options: .atomic)
    do {
      try apply(to: url)
    } catch {
      try? FileManager.default.removeItem(at: url)
      throw error
    }
  }

  public func apply(to url: URL) throws {
    var values = URLResourceValues()
    values.quarantineProperties = properties
    var file = url
    try file.setResourceValues(values)
  }
}
