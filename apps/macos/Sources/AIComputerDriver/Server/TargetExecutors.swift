import Foundation

/// A minimal `@unchecked Sendable` box for moving a non-Sendable value (an `AXUIElement`, a CF
/// result) across a thread boundary where the code guarantees single-threaded access by hand.
final class UncheckedBox<T>: @unchecked Sendable {
  var value: T
  init(_ value: T) { self.value = value }
}

/// The result of running work against a deadline: the value, or a timeout meaning the work is
/// still running on its detached thread and the target pid is now busy.
enum AbandonOutcome<T> {
  case completed(T)
  case timedOut
}

/// One serial executor per target pid plus an "abandonable" worker for AX actions that can spin a
/// nested run loop on the target side (menu/panel opens), which `AXUIElementSetMessagingTimeout`
/// does not bound (A2 conclusion 18). Such an action runs on a detached thread raced against the
/// request deadline: on timeout the handler returns promptly with `mayHaveDispatched`, the stuck
/// call is left to finish, and the pid is marked busy until it does so a second request cannot
/// pile on. The per-pid serial queue matches Peekaboo's detached-action pattern (MIT).
final class TargetExecutors: @unchecked Sendable {
  private let lock = NSLock()
  private var queues: [pid_t: DispatchQueue] = [:]
  private var busy: Set<pid_t> = []

  /// The serial queue for a pid, created on first use. All reads and actions for that target run
  /// here, so the target is never driven concurrently by two requests.
  func queue(for pid: pid_t) -> DispatchQueue {
    lock.lock()
    defer { lock.unlock() }
    if let existing = queues[pid] { return existing }
    let queue = DispatchQueue(label: "atd.computer.driver.pid.\(pid)")
    queues[pid] = queue
    return queue
  }

  func isBusy(_ pid: pid_t) -> Bool {
    lock.lock()
    defer { lock.unlock() }
    return busy.contains(pid)
  }

  private func setBusy(_ pid: pid_t, _ value: Bool) {
    lock.lock()
    defer { lock.unlock() }
    if value { busy.insert(pid) } else { busy.remove(pid) }
  }

  /// Run `body` on a detached thread, waiting up to `deadlineMilliseconds`. On timeout the pid is
  /// marked busy; the thread clears it when `body` eventually returns. `body` must be
  /// self-contained (it may touch AX on the detached thread) and is wrapped so its non-Sendable
  /// result can be read back.
  func runAbandonable<T>(
    pid: pid_t, deadlineMilliseconds: Double, _ body: @escaping @Sendable () -> T
  ) -> AbandonOutcome<T> {
    let result = UncheckedBox<T?>(nil)
    let semaphore = DispatchSemaphore(value: 0)
    setBusy(pid, true)
    let thread = Thread {
      result.value = body()
      semaphore.signal()
    }
    thread.stackSize = 1 << 20
    thread.start()

    let deadline = DispatchTime.now() + .milliseconds(Int(deadlineMilliseconds.rounded()))
    if semaphore.wait(timeout: deadline) == .timedOut {
      // Leave the thread to finish; clear busy when it signals, without blocking this executor.
      DispatchQueue.global().async {
        semaphore.wait()
        self.setBusy(pid, false)
      }
      return .timedOut
    }
    setBusy(pid, false)
    guard let value = result.value else { return .timedOut }
    return .completed(value)
  }
}
