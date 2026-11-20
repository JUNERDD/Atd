import AtdAutomations
import AtdModel
import Foundation
import Observation

/// The 自动化 tab's state: the automations and what they did, read from the App Group and read
/// again whenever a run writes (Shortcuts and the Live Activities' buttons run in this process,
/// in the background too). Edits are written at once; runs go through `AutomationEngine`.
@Observable
final class AutomationsModel {
  private(set) var book: AutomationBook
  private(set) var log: AutomationLog
  /// A write that failed, for the alert on the page.
  var failure: String?

  @ObservationIgnored let store: SharedStore
  @ObservationIgnored let engine: AutomationEngine?
  @ObservationIgnored private var observer: DarwinObserver?
  @ObservationIgnored private var watching: Task<Void, Never>?
  /// The runs the person started that keep going in the background, by automation.
  @ObservationIgnored private var continued: [String: ContinuedRun] = [:]

  init(store: SharedStore, engine: AutomationEngine?) {
    self.store = store
    self.engine = engine
    let isNew = store.load(AutomationBook.self).source == .missing
    try? store.createIfMissing(AutomationBook.self)
    book = store.load(AutomationBook.self).document
    log = store.load(AutomationLog.self).document
    // The App Shortcut that runs automations names them.
    if isNew { AtdShortcuts.refresh() }
  }

  /// The App Group's files and the app's engine. Without the group (previews), the app's own
  /// container and no runs.
  static func live() -> AutomationsModel {
    if let group = AppGroup.current(), let store = AutomationStore.live() {
      let model = AutomationsModel(store: store, engine: AutomationEngine.shared)
      model.watch(AutomationStore.notificationName(group))
      return model
    }
    let directory = URL.applicationSupportDirectory.appending(
      path: "Atd", directoryHint: .isDirectory)
    return AutomationsModel(
      store: SharedStore(directory: directory, notificationName: nil), engine: nil)
  }

  func reload() {
    book = store.load(AutomationBook.self).document
    log = store.load(AutomationLog.self).document
    for (id, run) in continued {
      run.report(log.latestRun(of: id))
    }
  }

  /// Atd came to the front: runs may have moved, or stopped while it was closed.
  func becameActive() {
    reload()
    guard let engine else { return }
    Task { await engine.reconcile() }
  }

  // MARK: Automations

  func automation(_ id: String) -> Automation? {
    book.automation(id)
  }

  func latestRun(of id: String) -> AutomationRun? {
    log.latestRun(of: id)
  }

  /// The automation's focus sessions, newest first.
  func sessions(of id: String) -> [FocusSession] {
    log.sessions.filter { $0.automationID == id }
  }

  func setEnabled(_ id: String, _ isEnabled: Bool) {
    guard var automation = book.automation(id), automation.isEnabled != isEnabled else { return }
    automation.isEnabled = isEnabled
    save(automation)
  }

  /// Saves an edited or new automation.
  func save(_ automation: Automation) {
    let renamed = book.automation(automation.id)?.name != automation.name
    write(AutomationBook.self) { $0.upsert(automation) }
    if renamed { AtdShortcuts.refresh() }
  }

  /// Deletes the automation and what it did. Shortcuts keeps its personal automation, which then
  /// says the automation was deleted.
  func remove(_ id: String) {
    write(AutomationBook.self) { $0.remove(id) }
    write(AutomationLog.self) { $0.forget(id) }
    AtdShortcuts.refresh()
  }

  // MARK: Runs

  /// 试一次: runs the automation now, as far as it goes; leaving Atd keeps it going. A focus
  /// automation starts or ends its session.
  func tryOut(_ automation: Automation) {
    let id = automation.id
    continueInBackground(automation) { engine in
      _ = await engine.trigger(id, source: .app, budget: nil)
    }
  }

  /// 跳过 in the app; the rest of the run follows, kept going as 试一次's is.
  func skip(_ run: AutomationRun) {
    guard case .awaiting(let step) = run.phase, let automation = book.automation(run.automationID)
    else { return }
    continueInBackground(automation) { engine in
      await engine.skip(run: run.id, step: step, budget: nil)
    }
  }

  /// How the compose sheet ended; the rest of the run follows in front.
  func finishMessage(_ run: AutomationRun, result: MessageResult) {
    guard case .awaiting(let step) = run.phase, let automation = book.automation(run.automationID)
    else { return }
    continueInBackground(automation) { engine in
      await engine.finishMessage(run: run.id, step: step, result: result, budget: nil)
    }
  }

  /// 继续: runs an interrupted run from where it stopped.
  func resume(_ run: AutomationRun) {
    guard let automation = book.automation(run.automationID) else { return }
    continueInBackground(automation) { engine in
      await engine.resume(run: run.id, budget: nil)
    }
  }

  func endFocus(_ session: FocusSession) {
    guard let engine else { return }
    Task { await engine.endFocus(session: session.id) }
  }

  /// Runs `work` with the engine, kept going by a continued-processing task when the person
  /// leaves Atd while a step still runs. A focus automation has no steps to wait for.
  private func continueInBackground(
    _ automation: Automation, _ work: @escaping @Sendable (AutomationEngine) async -> Void
  ) {
    guard let engine else { return }
    guard automation.focusLabel == nil else {
      Task { await work(engine) }
      return
    }
    let id = automation.id
    continued[id] = ContinuedRun(title: automation.name, steps: automation.steps.count) {
      await work(engine)
    } finished: { [weak self] run in
      if self?.continued[id] === run { self?.continued[id] = nil }
    }
  }

  // MARK: Files

  private func write<Document: SharedDocument>(
    _ type: Document.Type, _ change: (inout Document) -> Void
  ) {
    do {
      try store.update(type, change)
      reload()
    } catch {
      failure = AutomationText.string("failure.save")
    }
  }

  /// Reads the files again whenever a run or an edit changes them.
  private func watch(_ name: String) {
    let observer = DarwinObserver(name: name)
    self.observer = observer
    watching = Task { [weak self] in
      for await _ in observer.changes {
        self?.reload()
      }
    }
  }
}
