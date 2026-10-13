import AICore
import AppKit
import ApplicationServices

/// Follows where the person's focus is while the answer card is on screen, so the card offers
/// Insert (and Replace) only while that focus is a field that can take text
/// (``AnswerWriteOffer``). The island is a non-activating panel, so the app the person works in
/// stays frontmost even while the card has the keyboard: the watch follows the frontmost app
/// other than Atd (`NSWorkspace` activations) and, in it, an `AXObserver` on the application
/// element for focus and selection changes, which AppKit delivers on the main run loop. An app
/// whose observer cannot be made is asked again every ``pollInterval`` instead.
///
/// Each change is read off the main thread under ``readLimit`` (``AnswerFocusProbe``), and a
/// later change drops an earlier read. Only whether the focused element can take text and
/// whether it has a non-empty selection are read, never its text. Atd frontmost, a secure field,
/// no Accessibility or a read that times out offer nothing.
final class AnswerFocusWatch {
  /// The offer changed: nil while the focus cannot take text.
  var onChange: ((AnswerWriteOffer?) -> Void)?
  private(set) var offer: AnswerWriteOffer?

  private var running = false
  private var observer: AXObserver?
  private var observedPID: pid_t?
  private var activation: NSObjectProtocol?
  /// Bumped by every read and every stop, so a late read never lands.
  private var generation = 0
  private var poll: Task<Void, Never>?

  static let readLimit: Duration = .milliseconds(400)
  static let pollInterval: Duration = .seconds(1)

  /// Starts following the focus; a running watch carries on.
  func start() {
    guard !running else { return }
    running = true
    activation = NSWorkspace.shared.notificationCenter.addObserver(
      forName: NSWorkspace.didActivateApplicationNotification, object: nil, queue: .main
    ) { [weak self] _ in MainActor.assumeIsolated { self?.follow() } }
    follow()
  }

  /// Stops following, and offers nothing.
  func stop() {
    guard running else { return }
    running = false
    generation += 1
    if let activation { NSWorkspace.shared.notificationCenter.removeObserver(activation) }
    activation = nil
    observe(nil)
    publish(nil)
  }

  /// The frontmost app changed: its focus is the one to follow, unless it is Atd itself.
  private func follow() {
    let app = NSWorkspace.shared.frontmostApplication
    guard running, let app, app.processIdentifier != getpid(), SelectionReader.isTrusted else {
      observe(nil)
      return publish(nil)
    }
    observe(app.processIdentifier)
    refresh()
  }

  /// Something changed in the followed app: its focus is read again.
  fileprivate func refresh() {
    guard running, let pid = observedPID,
      let app = NSRunningApplication(processIdentifier: pid), !app.isTerminated
    else { return publish(nil) }
    generation += 1
    let token = generation
    let name = app.localizedName ?? app.bundleIdentifier ?? ""
    Task {
      let probe = AnswerFocusProbe(pid: pid)
      let read = await Deadline.value(within: Self.readLimit, fallback: nil) {
        await probe.read()
      }
      guard token == generation else { return }
      publish(read.map { AnswerWriteOffer(app: name, replaces: $0) })
    }
  }

  private func publish(_ next: AnswerWriteOffer?) {
    guard next != offer else { return }
    offer = next
    onChange?(next)
  }

  /// Observes `pid`'s focus and selection changes, or nothing; an app that refuses an observer
  /// is polled instead.
  private func observe(_ pid: pid_t?) {
    guard pid != observedPID else { return }
    if let observer {
      CFRunLoopRemoveSource(
        CFRunLoopGetMain(), AXObserverGetRunLoopSource(observer), .defaultMode)
    }
    observer = nil
    poll?.cancel()
    poll = nil
    observedPID = pid
    guard let pid else { return }
    var made: AXObserver?
    let element = AXUIElementCreateApplication(pid)
    let refcon = Unmanaged.passUnretained(self).toOpaque()
    guard AXObserverCreate(pid, answerFocusChanged, &made) == .success, let made,
      AXObserverAddNotification(
        made, element, kAXFocusedUIElementChangedNotification as CFString, refcon) == .success
    else { return startPolling() }
    _ = AXObserverAddNotification(
      made, element, kAXSelectedTextChangedNotification as CFString, refcon)
    CFRunLoopAddSource(CFRunLoopGetMain(), AXObserverGetRunLoopSource(made), .defaultMode)
    observer = made
  }

  private func startPolling() {
    poll = Task { [weak self] in
      while !Task.isCancelled {
        try? await Task.sleep(for: Self.pollInterval)
        guard !Task.isCancelled else { return }
        self?.refresh()
      }
    }
  }
}

/// The observer's callback, on the main run loop: `refcon` is the watch, which removes the
/// observer before it could go away.
private nonisolated let answerFocusChanged: AXObserverCallback = { _, _, _, refcon in
  guard let refcon else { return }
  let pointer = UInt(bitPattern: refcon)
  MainActor.assumeIsolated {
    guard let raw = UnsafeMutableRawPointer(bitPattern: pointer) else { return }
    Unmanaged<AnswerFocusWatch>.fromOpaque(raw).takeUnretainedValue().refresh()
  }
}

/// Reads the followed app's own focused element (not the system-wide one, which is the card's
/// while it has the keyboard): nil when it cannot take text or is a secure field, else whether
/// it has a non-empty selection, which ``SelectionPresence`` reads without the text (web
/// content's text-marker selections included). Each message is bounded by the selection
/// check's timeout.
nonisolated struct AnswerFocusProbe: Sendable {
  let pid: pid_t

  /// Where reads run: a serial queue of their own, so a blocking AX read never holds one of
  /// Swift concurrency's cooperative threads.
  private static let queue = DispatchQueue(label: "com.junerdd.ai.answer-focus", qos: .utility)

  func read() async -> Bool? {
    await withCheckedContinuation { continuation in
      Self.queue.async { continuation.resume(returning: readNow()) }
    }
  }

  /// True: writable with a selection; false: writable without one; nil: not writable.
  private func readNow() -> Bool? {
    let app = AXUIElementCreateApplication(pid)
    AXUIElementSetMessagingTimeout(app, SelectionPresence.messagingTimeout)
    // A browser reports no focus until its web content is woken; a later change or poll then
    // finds the field once its tree is built.
    SelectionPresence.wakeWebContent(app)
    guard let focused: AXUIElement = try? AXField.copy(app, kAXFocusedUIElementAttribute)
    else { return nil }
    AXUIElementSetMessagingTimeout(focused, SelectionPresence.messagingTimeout)
    guard (try? AXField.isSecure(focused)) == false, AXWritability.writable(focused) else {
      return nil
    }
    if case .selected = SelectionPresence(pid: pid).probe() { return true }
    return false
  }
}
