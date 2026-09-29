/// The one queue between the shell and one web view's page: every Swift → page message (call
/// results and errors, events, socket frames) leaves through it, so the page sees them in the
/// order Swift produced them.
///
/// Delivery follows spike S6: at most one `callAsyncJavaScript` in flight per web view, and the
/// first message queued while none is in flight is delivered on the next main-queue turn, so
/// what arrives in the same turn waits for one call. Each call carries one ``SwiftMessage``
/// (the contract's `deliver(message)`); consecutive socket frames are joined into one
/// `socket.frames` event of at most ``frameBatchBytes`` (its first frame always goes). S6
/// measured 8.1 ms p99 for a 2000-frame burst this way, against 141 ms when batching only per
/// run-loop turn.
///
/// What survives the page going away (a navigation or a WebContent crash):
/// - **States** (`window.active`, `window.visibility`): only the latest value per event, sent
///   once per change and again to every page that becomes ready.
/// - **App messages** (a command shortcut, imported attachments, an edit command): kept in order
///   until a ready page received them.
/// - **Document messages** (call results and errors, socket frames): dropped, since they belong
///   to the page that went away.
///
/// The outbox holds no timers or web views: its owner performs the ``Action`` it returns.
public struct BridgeOutbox: Sendable {
  public static var defaultFrameBatchBytes: Int { 4 * 1024 * 1024 }

  public enum Action: Equatable, Sendable {
    case none
    /// Call ``next()`` on the next main-queue turn and deliver what it returns.
    case flush
  }

  public enum Scope: Equatable, Sendable {
    /// Delivered to whichever page is ready next.
    case app
    /// Dropped when the current page goes away.
    case document
  }

  private enum Entry: Equatable, Sendable {
    case message(SwiftMessage, Scope)
    case frame(SocketFrame, bytes: Int)
  }

  private enum InFlight: Equatable, Sendable {
    case state(String)
    case entries([Entry])
  }

  public let frameBatchBytes: Int
  private var states: [String: NativeEvent] = [:]
  /// State names in first-set order, for a stable delivery order.
  private var stateOrder: [String] = []
  private var dirtyStates: Set<String> = []
  private var entries: [Entry] = []
  private var inFlight: InFlight?
  private var flushPending = false
  public private(set) var pageReady = false

  public init(frameBatchBytes: Int = Self.defaultFrameBatchBytes) {
    self.frameBatchBytes = max(1, frameBatchBytes)
  }

  public var isInFlight: Bool { inFlight != nil }
  /// Messages and frames waiting, states excluded.
  public var pendingCount: Int { entries.count }

  /// Records a state event; unchanged values are not sent again.
  public mutating func setState(_ event: NativeEvent) -> Action {
    let name = event.name
    if states[name] == nil { stateOrder.append(name) }
    guard states[name] != event else { return .none }
    states[name] = event
    dirtyStates.insert(name)
    return schedule()
  }

  public mutating func post(_ message: SwiftMessage, scope: Scope) -> Action {
    entries.append(.message(message, scope))
    return schedule()
  }

  /// `bytes` approximates the frame's size on the bridge, for splitting batches.
  public mutating func post(frame: SocketFrame, bytes: Int) -> Action {
    entries.append(.frame(frame, bytes: max(0, bytes)))
    return schedule()
  }

  /// The page installed its delivery function; every known state goes out again.
  public mutating func pageDidBecomeReady() -> Action {
    pageReady = true
    dirtyStates = Set(stateOrder)
    return schedule()
  }

  /// The page went away. A call still in flight is settled by ``completed(delivered:)``.
  public mutating func pageDidUnload() {
    pageReady = false
    entries.removeAll { entry in
      if case .message(_, .app) = entry { return false }
      return true
    }
  }

  /// The next message to deliver, or nil when none is due, no page is ready, or a call is in
  /// flight. A message marks a call in flight until ``completed(delivered:)``.
  public mutating func next() -> SwiftMessage? {
    flushPending = false
    guard pageReady, inFlight == nil else { return nil }
    if let name = stateOrder.first(where: dirtyStates.contains), let event = states[name] {
      dirtyStates.remove(name)
      inFlight = .state(name)
      return .event(event)
    }
    guard let first = entries.first else { return nil }
    if case .message(let message, _) = first {
      entries.removeFirst()
      inFlight = .entries([first])
      return message
    }
    var frames: [SocketFrame] = []
    var size = 0
    var taken = 0
    for entry in entries {
      guard case .frame(let frame, let bytes) = entry else { break }
      if !frames.isEmpty, size + bytes > frameBatchBytes { break }
      frames.append(frame)
      size += bytes
      taken += 1
    }
    inFlight = .entries(Array(entries.prefix(taken)))
    entries.removeFirst(taken)
    return .event(.socketFrames(SocketFramesEvent(frames: frames)))
  }

  /// The call in flight ended. A failed call means the page is gone or broken: it gets
  /// everything that survives again after its next `bridge.ready`, not a retry loop.
  public mutating func completed(delivered: Bool) -> Action {
    guard let settled = inFlight else { return .none }
    inFlight = nil
    if !delivered {
      switch settled {
      case .state(let name): dirtyStates.insert(name)
      case .entries(let failed): entries.insert(contentsOf: failed, at: 0)
      }
      pageDidUnload()
    }
    return schedule()
  }

  private mutating func schedule() -> Action {
    guard pageReady, inFlight == nil, !flushPending, !dirtyStates.isEmpty || !entries.isEmpty
    else { return .none }
    flushPending = true
    return .flush
  }
}

extension SocketFrame {
  /// Approximate size on the bridge, for ``BridgeOutbox`` batch splitting.
  public var byteCost: Int {
    switch self {
    case .open(let open): 48 + open.socketId.utf8.count
    case .message(let message): 48 + message.socketId.utf8.count + message.data.utf8.count
    case .close(let close): 48 + close.socketId.utf8.count + close.reason.utf8.count
    }
  }
}
