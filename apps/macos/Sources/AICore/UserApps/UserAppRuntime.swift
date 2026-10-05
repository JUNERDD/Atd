import Foundation

/// `GET /v1/apps/:appId/runtime`: what the shell needs to host an app's current version.
public struct UserAppRuntime: Decodable, Equatable, Sendable {
  public struct Window: Decodable, Equatable, Sendable {
    public let width: Double
    public let height: Double
    public let minWidth: Double
    public let minHeight: Double
  }

  /// The window material the version's manifest asks for (`window.surface` in `atd-app.json`).
  public enum Surface: String, Decodable, Equatable, Sendable {
    /// Atd's own window: the settings window's glass and 52 pt unified title bar around a
    /// transparent page, whose build paints the task panel's fill and lays its first row out on
    /// the title bar.
    case glass
    /// A conventional titled, opaque window whose page paints everything; what a runtime without
    /// the key means, as for every version built before surfaces existed.
    case opaque
  }

  public let appId: String
  public let name: String
  public let version: Int
  /// Absolute path of `versions/<n>/web`, the only directory the handler serves files from.
  public let webRoot: String
  /// The app's `WKWebsiteDataStore` identifier: a UUID the service generated once.
  public let dataStoreId: String
  public let window: Window
  public let surface: Surface

  private enum CodingKeys: String, CodingKey {
    case appId, name, version, webRoot, dataStoreId, window, surface
  }

  public init(from decoder: any Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    appId = try container.decode(String.self, forKey: .appId)
    name = try container.decode(String.self, forKey: .name)
    version = try container.decode(Int.self, forKey: .version)
    webRoot = try container.decode(String.self, forKey: .webRoot)
    dataStoreId = try container.decode(String.self, forKey: .dataStoreId)
    window = try container.decode(Window.self, forKey: .window)
    surface = try container.decodeIfPresent(Surface.self, forKey: .surface) ?? .opaque
  }

  public enum Invalid: Error, Equatable, Sendable {
    case wrongApp
    case version
    case webRoot
    case dataStore
    case window
  }

  /// Decodes and checks a runtime answer for `appId`. The service is trusted, but a mismatched
  /// id or a relative root would make the handler serve the wrong files, so those fail here.
  public static func decode(_ data: Data, appId: String) throws -> UserAppRuntime {
    let runtime = try JSONDecoder().decode(UserAppRuntime.self, from: data)
    try runtime.validate(appId: appId)
    return runtime
  }

  public func validate(appId expected: String) throws(Invalid) {
    guard appId == expected else { throw .wrongApp }
    guard version >= 1 else { throw .version }
    guard webRoot.hasPrefix("/") else { throw .webRoot }
    guard dataStore != nil else { throw .dataStore }
    let sizes = [window.width, window.height, window.minWidth, window.minHeight]
    guard sizes.allSatisfy({ $0.isFinite && $0 > 0 }) else { throw .window }
  }

  /// The parsed ``dataStoreId``.
  public var dataStore: UUID? { UUID(uuidString: dataStoreId) }

  public var webRootURL: URL { URL(filePath: webRoot, directoryHint: .isDirectory) }
}

/// Placement of an app's window: the size the app asks for, centered, or where the user last
/// left it; always inside the current work area.
public enum UserAppGeometry {
  /// The resize floor the app asks for, never larger than the work area.
  public static func minimumSize(_ window: UserAppRuntime.Window, in workArea: ScreenRect)
    -> WindowSize
  {
    WindowSize(
      width: min(window.minWidth, workArea.width), height: min(window.minHeight, workArea.height))
  }

  /// A remembered frame moved and shrunk into the work area, otherwise the app's preferred size
  /// centered in it.
  public static func frame(
    remembered: ScreenRect?, window: UserAppRuntime.Window, in workArea: ScreenRect
  ) -> ScreenRect {
    let minimum = minimumSize(window, in: workArea)
    if let remembered {
      var frame = PanelGeometry.constrain(remembered, to: workArea)
      frame.width = max(frame.width, minimum.width)
      frame.height = max(frame.height, minimum.height)
      return PanelGeometry.constrain(frame, to: workArea)
    }
    let width = min(max(window.width, minimum.width), workArea.width)
    let height = min(max(window.height, minimum.height), workArea.height)
    return ScreenRect(
      x: workArea.x + ((workArea.width - width) / 2).rounded(.down),
      y: workArea.y + ((workArea.height - height) / 2).rounded(.down),
      width: width,
      height: height)
  }
}
