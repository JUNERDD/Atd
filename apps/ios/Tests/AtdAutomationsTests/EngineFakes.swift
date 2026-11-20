import AtdAI
import AtdActions
import AtdModel
import Foundation
import Synchronization

@testable import AtdAutomations

/// Answers each request with the next scripted reply, and keeps every request it was sent.
final class ScriptedModel: TextGenerating {
  enum Reply: Sendable {
    case text(String)
    case failure(ModelFailure)
    /// A stream that stays open until the run's task is cancelled, as a slow provider's does.
    case open
  }

  private let replies: Mutex<[Reply]>
  private let sent = Mutex<[ModelRequest]>([])
  private let open = Mutex<[AsyncThrowingStream<String, any Error>.Continuation]>([])

  init(_ replies: [Reply] = []) {
    self.replies = Mutex(replies)
  }

  var requests: [ModelRequest] { sent.withLock { $0 } }

  func stream(_ request: ModelRequest, choice: ModelChoice) -> AsyncThrowingStream<
    String, any Error
  > {
    sent.withLock { $0.append(request) }
    let reply = replies.withLock { $0.isEmpty ? Reply.failure(.noModel) : $0.removeFirst() }
    let (stream, continuation) = AsyncThrowingStream<String, any Error>.makeStream()
    switch reply {
    case .text(let text):
      continuation.yield(text)
      continuation.finish()
    case .failure(let failure):
      continuation.finish(throwing: failure)
    case .open:
      open.withLock { $0.append(continuation) }
    }
    return stream
  }
}

/// A day with the same events and reminders whatever day is asked for; nil reads as no access.
struct FakeAgenda: AgendaReading {
  var events: [AgendaEvent]?
  var reminders: [AgendaReminder]? = []

  func agenda(for day: Date, asking: Bool) async throws -> Agenda {
    guard events != nil || reminders != nil else { throw ActionError.denied(.calendar) }
    return Agenda(day: day, events: events, reminders: reminders)
  }
}

/// Records what the engine shows, and which activities are on show. `allowsStart: false` is the
/// system declining (Live Activities off).
final class FakeActivities: ActivityPresenting {
  typealias Phase = AutomationActivityAttributes.ContentState.Phase

  enum Call: Equatable {
    case startRun(Phase)
    case updateRun(Phase, alert: Bool)
    case endRun(Phase, ActivityDismissal)
    case startFocus
    case endFocus(ActivityDismissal)
  }

  private struct State {
    var calls: [Call] = []
    var live: Set<String> = []
    var count = 0
    var states: [AutomationActivityAttributes.ContentState] = []
  }

  private let allowsStart: Bool
  private let state = Mutex(State())

  init(allowsStart: Bool = true) {
    self.allowsStart = allowsStart
  }

  var calls: [Call] { state.withLock { $0.calls } }
  /// Every run state shown, in order.
  var shown: [AutomationActivityAttributes.ContentState] { state.withLock { $0.states } }

  /// The person swiped the activity away.
  func dismissAll() {
    state.withLock { $0.live = [] }
  }

  func startRun(
    _ attributes: AutomationActivityAttributes,
    _ content: AutomationActivityAttributes.ContentState,
    staleDate: Date?, relevance: Double
  ) -> String? {
    guard allowsStart else { return nil }
    return state.withLock {
      $0.count += 1
      $0.live.insert("run-\($0.count)")
      $0.calls.append(.startRun(content.phase))
      $0.states.append(content)
      return "run-\($0.count)"
    }
  }

  func updateRun(
    _ id: String, _ content: AutomationActivityAttributes.ContentState, staleDate: Date?,
    relevance: Double, alert: ActivityAlert?
  ) async {
    state.withLock {
      $0.calls.append(.updateRun(content.phase, alert: alert != nil))
      $0.states.append(content)
    }
  }

  func endRun(
    _ id: String, _ content: AutomationActivityAttributes.ContentState, dismissal: ActivityDismissal
  ) async {
    state.withLock {
      $0.live.remove(id)
      $0.calls.append(.endRun(content.phase, dismissal))
      $0.states.append(content)
    }
  }

  func startFocus(
    _ attributes: FocusActivityAttributes, _ content: FocusActivityAttributes.ContentState
  ) -> String? {
    guard allowsStart else { return nil }
    return state.withLock {
      $0.count += 1
      $0.live.insert("focus-\($0.count)")
      $0.calls.append(.startFocus)
      return "focus-\($0.count)"
    }
  }

  func endFocus(
    _ id: String, _ content: FocusActivityAttributes.ContentState, dismissal: ActivityDismissal
  ) async {
    state.withLock {
      $0.live.remove(id)
      $0.calls.append(.endFocus(dismissal))
    }
  }

  func isActive(_ id: String) -> Bool {
    state.withLock { $0.live.contains(id) }
  }
}

/// A clock the test moves on by hand.
final class TestClock: Sendable {
  private let current: Mutex<Date>

  init(_ start: Date) {
    current = Mutex(start)
  }

  var now: Date { current.withLock { $0 } }

  func advance(_ seconds: TimeInterval) {
    current.withLock { $0 = $0.addingTimeInterval(seconds) }
  }
}

/// An engine on a fresh temporary directory, with the library's built-in commands and the
/// given automations.
struct EngineFixture {
  /// Saturday 21 November 2026, 14:05 in Shanghai.
  static let start = Date(timeIntervalSince1970: 1_795_241_100)
  static let calendar: Calendar = {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = TimeZone(identifier: "Asia/Shanghai") ?? .gmt
    return calendar
  }()

  let store: SharedStore
  let model: ScriptedModel
  let activities: FakeActivities
  let clock: TestClock
  let engine: AutomationEngine

  init(
    _ automations: [Automation], model: ScriptedModel = ScriptedModel(),
    agenda: FakeAgenda = FakeAgenda(events: []), activities: FakeActivities = FakeActivities()
  ) throws {
    let directory = FileManager.default.temporaryDirectory.appending(
      path: "automations-\(UUID().uuidString)", directoryHint: .isDirectory)
    store = SharedStore(directory: directory, notificationName: nil)
    try store.createIfMissing(CommandLibrary.self)
    try store.update(AutomationBook.self) { $0.automations = automations }
    self.model = model
    self.activities = activities
    let clock = TestClock(Self.start)
    self.clock = clock
    engine = AutomationEngine(
      environment: AutomationEnvironment(
        store: store, generator: model, agenda: agenda, activities: activities,
        now: { clock.now }, calendar: Self.calendar))
  }

  var book: AutomationBook { store.load(AutomationBook.self).document }
  var log: AutomationLog { store.load(AutomationLog.self).document }
  var library: CommandLibrary { store.load(CommandLibrary.self).document }

  func trigger(_ id: String = "a", source: RunSource = .shortcuts, budget: Duration? = nil) async
    -> TriggerOutcome
  {
    await engine.trigger(id, source: source, budget: budget)
  }

  static func automation(_ id: String = "a", steps: [AutomationStep], isEnabled: Bool = true)
    -> Automation
  {
    Automation(
      id: id, trigger: AutomationTrigger(family: .arrive, title: "到家时"), name: "到家清单",
      symbol: "house", tint: .orange, steps: steps, isEnabled: isEnabled)
  }

  /// 开始专注记录 on an NFC tag.
  static let desk = Automation(
    id: "desk", trigger: AutomationTrigger(family: .nfc, title: "碰一下「书桌」NFC 标签"),
    name: "开始专注记录", symbol: "sensor.tag.radiowaves.forward", tint: .gray,
    steps: [.focus(label: "书桌")])

  /// A command of the person's that reads nothing and answers in text.
  static let planner = Command(
    id: "planner", name: "排个计划", symbol: "list.bullet", tint: .blue,
    instructions: "给我排一个下午的计划", input: .none, output: CommandOutput(action: .replace),
    placement: CommandPlacement(siri: true))

  func add(_ command: Command) throws {
    try store.update(CommandLibrary.self) { $0.commands.append(command) }
  }

  /// The ledger with two expenses today, ¥68 in all.
  func logTwoExpenses() throws {
    let book = LedgerBook(store: store, reloadWidgets: {})
    for amount in [Decimal(18), Decimal(50)] {
      try book.add(
        ExpenseDraft(
          amount: amount, currency: "CNY", category: .dining, date: Self.start, book: "日常"),
        source: .manual, at: Self.start)
    }
  }

  /// Waits until `condition` holds, for up to two seconds.
  static func eventually(_ condition: () -> Bool) async throws {
    let deadline = ContinuousClock.now + .seconds(2)
    while !condition(), ContinuousClock.now < deadline {
      try await Task.sleep(for: .milliseconds(10))
    }
  }
}

extension TriggerOutcome {
  /// The run, when the trigger ran one.
  var run: AutomationRun? {
    if case .ran(_, let run) = self { run } else { nil }
  }
}

extension AutomationRun {
  /// The run after `move`, or nil when the move does not apply where the run is.
  func after(_ move: (inout AutomationRun) -> Bool) -> AutomationRun? {
    var moved = self
    return move(&moved) ? moved : nil
  }
}
