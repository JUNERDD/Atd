import Foundation

/// Tells the service how long the Mac has been idle, so its idle automations know when they may
/// run: once the service link is up, then every ``SystemActivityReport/reportSeconds``, and again
/// on demand (the Mac woke). The service counts a report older than
/// ``SystemActivityReport/staleSeconds`` as unknown, so reporting stops while the link is down
/// and a failed report is not retried before the next one is due.
///
/// A new report restarts the schedule, so a report on wake never doubles up with one that was
/// about to be sent.
@MainActor
public final class SystemActivityReporter {
  /// The one shell-only route, bound to the service as it is for one report.
  public typealias Service = @Sendable (_ report: SystemActivityReport) async throws -> Void

  private let connect: @MainActor () async -> Service?
  private let idleSeconds: @MainActor () -> Double
  private let sleep: @Sendable (Duration) async throws -> Void
  private let report: @MainActor (any Error) -> Void
  private var loop: Task<Void, Never>?

  /// - Parameters:
  ///   - connect: the service's route, or nil while it is unavailable (the next report tries
  ///     again).
  ///   - idleSeconds: seconds since the last input, read when each report is made.
  ///   - sleep: how long the reporter waits between reports (replaced in tests).
  ///   - report: a report that failed, for the log; never shown to the person.
  public init(
    connect: @escaping @MainActor () async -> Service?,
    idleSeconds: @escaping @MainActor () -> Double,
    sleep: @escaping @Sendable (Duration) async throws -> Void = { try await Task.sleep(for: $0) },
    report: @escaping @MainActor (any Error) -> Void
  ) {
    self.connect = connect
    self.idleSeconds = idleSeconds
    self.sleep = sleep
    self.report = report
  }

  public var isRunning: Bool { loop != nil }

  /// The service link came up (or came back): reports now, then on the interval, until
  /// ``stop()``.
  public func start() {
    loop?.cancel()
    loop = Task { [weak self] in
      while !Task.isCancelled {
        guard let self else { return }
        await reportOnce()
        let wait = sleep
        do { try await wait(.seconds(SystemActivityReport.reportSeconds)) } catch { return }
      }
    }
  }

  /// The service link is down: nothing is reported until ``start()``.
  public func stop() {
    loop?.cancel()
    loop = nil
  }

  /// The Mac woke: while the link is up, reports now and restarts the interval.
  public func reportNow() {
    if isRunning { start() }
  }

  private func reportOnce() async {
    guard let service = await connect() else { return }
    do {
      try await service(SystemActivityReport(idleSeconds: idleSeconds()))
    } catch  where !Task.isCancelled {
      // A report cancelled by a newer one or by ``stop()`` is not a failure.
      report(error)
    } catch {}
  }
}
