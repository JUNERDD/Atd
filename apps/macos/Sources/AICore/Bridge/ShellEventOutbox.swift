/// A shell-to-page event: a name the page's receiver dispatches on and its JSON payload.
public struct ShellEvent: Equatable, Sendable {
  public let name: String
  public let payload: JSONValue

  public init(name: String, payload: JSONValue) {
    self.name = name
    self.payload = payload
  }
}

/// The queue between the shell and one web view's page.
///
/// Two kinds of events:
/// - **State** (window activity, visibility, language): only the latest value matters. Each is
///   delivered once per change and again to every page that becomes ready, so a page rebuilt
///   after a WebContent crash starts from the current state.
/// - **One-shot** (a command shortcut's `{id}`, an attachment result): delivered once, in
///   order. They wait while no page is ready and survive a crash until delivered.
///
/// Delivery follows spike S6: at most one call in flight per web view; whatever arrives
/// meanwhile goes out together as the next batch. States come before one-shots in a batch, so
/// a command lands on a page that already knows it is visible.
public struct ShellEventOutbox: Sendable {
  private var states: [String: JSONValue] = [:]
  /// State names in first-set order, for a stable batch order.
  private var stateOrder: [String] = []
  private var dirtyStates: Set<String> = []
  private var oneShots: [ShellEvent] = []
  /// The batch handed out and not yet settled: its state names and its one-shots.
  private var inFlight: (states: [String], oneShots: [ShellEvent])?

  public private(set) var pageReady = false

  public init() {}

  public mutating func setState(_ name: String, _ payload: JSONValue) {
    if states[name] == nil { stateOrder.append(name) }
    guard states[name] != payload else { return }
    states[name] = payload
    dirtyStates.insert(name)
  }

  public mutating func post(_ event: ShellEvent) {
    oneShots.append(event)
  }

  /// The page said it is ready to receive; every known state goes out again.
  public mutating func pageDidBecomeReady() {
    pageReady = true
    dirtyStates = Set(stateOrder)
  }

  /// The page went away (navigation, WebContent crash). An in-flight batch is settled by its
  /// call's completion, which fails when the process died.
  public mutating func pageDidUnload() {
    pageReady = false
  }

  /// The next batch to deliver, or nil when nothing is due or a call is still in flight.
  public mutating func nextBatch() -> [ShellEvent]? {
    guard pageReady, inFlight == nil, !dirtyStates.isEmpty || !oneShots.isEmpty else {
      return nil
    }
    let names = stateOrder.filter(dirtyStates.contains)
    let batch =
      names.compactMap { name in states[name].map { ShellEvent(name: name, payload: $0) } }
      + oneShots
    inFlight = (names, oneShots)
    dirtyStates.removeAll()
    oneShots.removeAll()
    return batch
  }

  /// Settles the in-flight batch. A failed batch (the page threw, or its process died) puts
  /// its one-shots back in front of newer ones and marks its states for the next ready page.
  public mutating func batchDidFinish(delivered: Bool) {
    guard let batch = inFlight else { return }
    inFlight = nil
    guard !delivered else { return }
    oneShots = batch.oneShots + oneShots
    dirtyStates.formUnion(batch.states)
  }
}
