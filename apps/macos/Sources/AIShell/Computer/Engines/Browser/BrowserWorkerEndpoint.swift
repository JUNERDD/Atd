import AICore
import Darwin

/// Which browser a worker drives, as its `ATD_BROWSER_CHANNEL` tells it
/// (`apps/agent-service/src/computer/worker/connection.ts`).
nonisolated enum BrowserWorkerChannel: Equatable, Sendable {
  /// A managed profile: the variable stays unset, so the worker runs as it did before the channel
  /// existed (Playwright's defaults, `open_page`, `restore_windows`, downloads saved for the run).
  case managed
  /// The person's own Chrome through Atd for Chrome (`chrome`): the worker connects with
  /// `noDefaults`, refuses `open_page` and `restore_windows`, and reports no downloads.
  case chrome
}

/// The browser one worker generation drives: what ``BrowserWorkerPool`` keys the worker by and how
/// the worker reaches the browser. A managed Chrome (``ManagedChromeInstance``) and a connected
/// Chrome of the person's (the chrome engine's relay) are both one.
protocol BrowserWorkerEndpoint: Sendable {
  /// The worker's key: a managed profile id, or a paired Chrome's installation id.
  var profileId: String { get }
  /// The browser instance the worker drives (a process, a connection); a call for another one
  /// ends the worker that drives the old one.
  var contextId: String { get }
  /// The verified browser websocket the worker connects to (`ATD_CDP_WS`).
  var webSocketURL: String { get }
  var channel: BrowserWorkerChannel { get }
  /// The browser process the person would use the pages through, which surfaces name.
  var pid: pid_t { get }
  /// That process's start identity, so a reused pid never matches.
  var processStart: String { get }
}

extension ManagedChromeInstance: BrowserWorkerEndpoint {
  var channel: BrowserWorkerChannel { .managed }
  var processStart: String { String(start) }
}
