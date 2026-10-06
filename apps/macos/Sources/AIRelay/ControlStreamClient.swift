import AICore
import Foundation

/// Serves the five desktop capabilities the control stream registers. Implemented by the window
/// side of the shell (panels, pasteboard, selection); called on the main actor, possibly for
/// several requests at once.
public protocol CapabilityHandling: AnyObject {
  /// Returns the capability's result value, or throws; the error's description becomes the
  /// failure message the agent sees (cut to 2000 characters).
  func handle(_ request: CapabilityRequest) async throws -> JSONValue
}

/// The shell's own stream connection (decisions Q4-4', Q5-A1/A2): the only connection Swift
/// reconnects itself. On every open it subscribes with no tasks and `status: true`, registers
/// the five desktop capabilities, and pings inside the capability lease. It decodes only the
/// control frames (``ControlFrame``), including the `widgets` and `automations` invalidations,
/// and drops everything else.
public final class ControlStreamClient {
  public enum ConnectionState: Equatable, Sendable {
    /// Trying to connect, and never connected since ``start()``: keep the last known status.
    case connecting
    case connected
    /// Connected before, dropped, retrying: show the service as unavailable.
    case reconnecting
    /// No service endpoint (Debug: `pnpm dev` is not running), or stopped.
    case disconnected
  }

  /// Root tasks running and needing attention, for the menu bar.
  public struct Status: Equatable, Sendable {
    public let running: Int
    public let attention: Int
  }

  public private(set) var state: ConnectionState = .disconnected {
    didSet { if state != oldValue { onConnectionState?(state) } }
  }
  public private(set) var status: Status?
  public var onConnectionState: (@MainActor (ConnectionState) -> Void)?
  public var onStatus: (@MainActor (Status) -> Void)?
  /// The service's widget catalog or snapshots changed (`invalidate` scope `widgets`).
  public var onWidgetsInvalidated: (@MainActor () -> Void)?
  /// An automation, its runs or the pending notices changed (`invalidate` scope `automations`).
  public var onAutomationsInvalidated: (@MainActor () -> Void)?
  /// Why the service is unavailable while ``state`` is ``ConnectionState/disconnected``.
  public private(set) var unavailable: ServiceUnavailable?

  private let link: ServiceLink
  private weak var capabilities: (any CapabilityHandling)?
  private var socket: ServiceWebSocket?
  private var loop: Task<Void, Never>?
  private var pinger: Task<Void, Never>?
  private var observation: ServiceLinkObservation?
  private var wake: CheckedContinuation<Void, Never>?

  public init(link: ServiceLink, capabilities: any CapabilityHandling) {
    self.link = link
    self.capabilities = capabilities
  }

  public func start() {
    guard loop == nil else { return }
    state = .connecting
    observation = link.observeChanges { [weak self] current in
      guard let self, let socket, current.map({ !socket.endpoint.isSameInstance(as: $0) }) ?? true
      else { return }
      socket.close(code: WebSocketCloseCode.serviceRestart, reason: "The agent service restarted.")
      connectionEnded()
    }
    loop = Task { await run() }
  }

  public func stop() {
    loop?.cancel()
    loop = nil
    observation = nil
    socket?.close(code: 1000, reason: "The app is quitting.")
    connectionEnded()
    state = .disconnected
  }

  private func run() async {
    var failures = 0
    var everConnected = false
    while !Task.isCancelled {
      let resolved = await link.endpoint()
      guard !Task.isCancelled else { return }
      switch resolved {
      case .failure(let reason):
        unavailable = reason
        state = .disconnected
      case .success(let endpoint):
        unavailable = nil
        state = everConnected ? .reconnecting : .connecting
        if await connect(endpoint) {
          everConnected = true
          failures = 0
        }
        guard !Task.isCancelled else { return }
        state = everConnected ? .reconnecting : .connecting
      }
      try? await Task.sleep(for: ControlStream.reconnectDelay(failures: failures))
      failures += 1
    }
  }

  /// Runs one connection until it closes; true when it opened.
  private func connect(_ endpoint: ServiceEndpoint) async -> Bool {
    var opened = false
    let socket = ServiceWebSocket(
      endpoint: endpoint,
      events: .init(
        onOpen: { [weak self] in
          opened = true
          self?.opened()
        },
        onText: { [weak self] in self?.handle($0) },
        onBinary: {},
        onClose: { [weak self] code, reason in
          RelayLog.control.info("The control stream closed (\(code) \(reason)).")
          self?.connectionEnded()
        }))
    self.socket = socket
    await withCheckedContinuation { continuation in
      wake = continuation
      socket.start()
    }
    return opened
  }

  private func opened() {
    guard let socket else { return }
    socket.send(ControlStream.subscribe())
    socket.send(ControlStream.register(DesktopCapability.allCases))
    state = .connected
    pinger = Task { [weak self] in
      while !Task.isCancelled {
        try? await Task.sleep(for: ControlStream.pingInterval)
        guard !Task.isCancelled else { return }
        self?.socket?.send(ControlStream.ping())
      }
    }
  }

  private func connectionEnded() {
    pinger?.cancel()
    pinger = nil
    socket = nil
    wake?.resume()
    wake = nil
  }

  private func handle(_ text: String) {
    switch ControlFrameDecoder.decode(text) {
    case .frame(.status(let running, let attention)):
      let status = Status(running: running, attention: attention)
      self.status = status
      onStatus?(status)
    case .frame(.capabilityRequest(let request)):
      serve(request)
    case .frame(.capabilityRegistered(let clientId)):
      RelayLog.control.info("Desktop capabilities registered as \(clientId, privacy: .public).")
    case .frame(.capabilityAck(let requestId, let ok, let error)):
      if !ok {
        RelayLog.control.error(
          "The service refused capability result \(requestId): \(error ?? "no reason")")
      }
    case .frame(.widgetsInvalidated):
      onWidgetsInvalidated?()
    case .frame(.automationsInvalidated):
      onAutomationsInvalidated?()
    case .frame(.pong), .ignored:
      break
    case .frame(.error(let message)):
      RelayLog.control.error("The control stream reported: \(message)")
    case .malformed(let type):
      RelayLog.control.error("Dropped a malformed \(type, privacy: .public) frame.")
    }
  }

  /// Results go to whichever connection is live when the handler finishes: the service matches
  /// them by request id and revision, not by connection. With none live the result is lost and
  /// the request expires.
  private func serve(_ request: CapabilityRequest) {
    Task {
      let result: CapabilityResult
      if let capabilities {
        do {
          result = .success(request, value: try await capabilities.handle(request))
        } catch {
          result = .failure(request, error: Self.message(for: error))
        }
      } else {
        result = .failure(request, error: "The desktop app cannot serve this request now.")
      }
      let frame =
        (try? ControlStream.result(result))
        ?? (try? ControlStream.result(.failure(request, error: "The result could not be encoded.")))
      if let frame { socket?.send(frame) }
    }
  }

  private static func message(for error: any Error) -> String {
    (error as? any LocalizedError)?.errorDescription ?? String(describing: error)
  }
}
