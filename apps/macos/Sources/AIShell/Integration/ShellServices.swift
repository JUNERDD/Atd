import AICore
import AIRelay
import AppKit
import OSLog

/// The two windows that host the renderer.
public enum WebViewRole: String, Sendable {
  case panel
  case settings
}

/// Where the shell's renderer and service come from (decision Q10), chosen once per build:
/// - **Debug** connects to what `pnpm dev` runs: the service of the development data directory
///   (never started, replaced or stopped here) and the Vite dev server for renderer files.
/// - **Release** serves the bundled renderer and supervises the bundled service, which logs to
///   `~/Library/Logs/AI`.
///
/// `AI_AGENT_DATA_DIR` overrides the data directory in both; in Debug `AI_RENDERER_DEV_ORIGIN`
/// overrides the dev server origin (`http://127.0.0.1:5173`), for isolated runs.
public final class ShellServices {
  public static let devOriginVariable = "AI_RENDERER_DEV_ORIGIN"
  public static let defaultDevOrigin = "http://127.0.0.1:5173"

  public let link: ServiceLink
  public let renderer: RendererSource
  public let dataDirectory: URL
  private let supervisor: ServiceSupervisor?
  private let logDirectory: URL?
  /// One handler serves both windows' web views and every rebuild of them.
  private(set) lazy var schemeHandler = RendererSchemeHandler(renderer: renderer, link: link)

  private init(
    source: any ServiceEndpointSource, renderer: RendererSource, dataDirectory: URL,
    supervisor: ServiceSupervisor?, logDirectory: URL?
  ) {
    link = ServiceLink(source: source)
    self.renderer = renderer
    self.dataDirectory = dataDirectory
    self.supervisor = supervisor
    self.logDirectory = logDirectory
  }

  /// The services of this build configuration.
  public static func forThisBuild(
    environment: [String: String] = ProcessInfo.processInfo.environment,
    home: URL = FileManager.default.homeDirectoryForCurrentUser
  ) -> ShellServices {
    #if DEBUG
      development(environment: environment, home: home)
    #else
      bundled(
        resources: Bundle.main.resourceURL ?? Bundle.main.bundleURL, environment: environment,
        home: home)
    #endif
  }

  public static func development(environment: [String: String], home: URL) -> ShellServices {
    let raw = environment[devOriginVariable] ?? defaultDevOrigin
    guard let url = URL(string: raw), let origin = DevServerOrigin(url) else {
      preconditionFailure("\(devOriginVariable) must be a loopback http origin, not \(raw).")
    }
    let data = ServiceDataDirectory.resolve(environment: environment, home: home, development: true)
    return ShellServices(
      source: DevelopmentServiceSource(dataDirectory: data), renderer: .devServer(origin),
      dataDirectory: data, supervisor: nil, logDirectory: nil)
  }

  public static func bundled(resources: URL, environment: [String: String], home: URL)
    -> ShellServices
  {
    let data = ServiceDataDirectory.resolve(
      environment: environment, home: home, development: false)
    let logs = home.appending(path: "Library/Logs/AI", directoryHint: .isDirectory)
    let supervisor = ServiceSupervisor(
      plan: ServiceLaunchPlan(resources: resources, dataDirectory: data), logDirectory: logs)
    return ShellServices(
      source: supervisor,
      renderer: .bundle(resources.appending(path: "renderer", directoryHint: .isDirectory)),
      dataDirectory: data, supervisor: supervisor, logDirectory: logs)
  }

  /// Brings the supervised service up (Release); Debug only connects.
  func start() {
    guard let supervisor else { return }
    Task { await supervisor.start() }
  }

  /// The menu's Restart Service; also the way back after automatic restarts gave up.
  func restart() async throws {
    guard let supervisor else {
      throw ShellServiceError(ShellStrings.shared.text(.errorDevelopmentRestart))
    }
    await supervisor.restart()
    switch supervisor.state {
    case .unavailable(.failed(let detail)): throw ShellServiceError(detail)
    case .unavailable:
      throw ShellServiceError(ShellStrings.shared.text(.errorRestartServiceMessage))
    default: break
    }
  }

  /// Shows the service's log file in Finder.
  func revealLogs() throws {
    guard let logDirectory else {
      throw ShellServiceError(ShellStrings.shared.text(.errorDevelopmentLogs))
    }
    let log = logDirectory.appending(path: ServiceLogRotation.current)
    guard FileManager.default.fileExists(atPath: log.path(percentEncoded: false)) else {
      throw ShellServiceError(ShellStrings.shared.text(.errorShowLogsMessage))
    }
    NSWorkspace.shared.activateFileViewerSelecting([log])
  }

  /// A committed quit: stops the supervised service (shutdown, then SIGTERM). Debug leaves the
  /// development service running.
  func stopForQuit() async {
    await supervisor?.stop()
  }

  /// The shell's own client for the service as it is now.
  func client() async throws(ShellServiceError) -> ShellClient {
    switch await link.endpoint() {
    case .success(let endpoint): return ShellClient(endpoint: endpoint)
    case .failure: throw ShellServiceError("The agent service is not available.")
    }
  }
}

/// A service action that failed, with the message a menu alert or the page shows.
struct ShellServiceError: LocalizedError {
  let errorDescription: String?
  init(_ message: String) { errorDescription = message }
}
