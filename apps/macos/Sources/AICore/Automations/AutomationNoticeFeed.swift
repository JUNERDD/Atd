/// Turns the service's automation notices into system notifications, each posted once (decision
/// D5). On every `automations` invalidation, and once per (re)connection for notices made while
/// the shell was away, it reads the pending notices (`GET /v1/automation-notices`), posts those it
/// has not posted yet, then acknowledges every notice it read (`POST /v1/automation-notices/ack`).
/// A notice is acknowledged whether or not it could be shown (notifications not allowed), so
/// none comes back on every pull; the service drops what nobody acknowledged after an hour.
///
/// One pull runs at a time: requests during a pull run one more after it, so a burst of
/// invalidations costs at most two reads. A notice posted but not acknowledged (the
/// acknowledgement failed) is remembered while the service still lists it, so the next pull
/// acknowledges it without posting it again.
@MainActor
public final class AutomationNoticeFeed {
  /// The two shell-only routes, bound to the service as it is for one pull.
  public struct Service: Sendable {
    public let pending: @Sendable () async throws -> [AutomationNotice]
    public let acknowledge: @Sendable (_ ids: [String]) async throws -> Void

    public init(
      pending: @escaping @Sendable () async throws -> [AutomationNotice],
      acknowledge: @escaping @Sendable (_ ids: [String]) async throws -> Void
    ) {
      self.pending = pending
      self.acknowledge = acknowledge
    }
  }

  /// A pull that went wrong. The notices stay pending in the service for the next pull.
  public enum Failure: Sendable {
    /// The read failed or answered outside the contract: nothing was posted.
    case read(any Error)
    /// The acknowledgement failed: the notices were posted and are acknowledged next time.
    case acknowledge(any Error)
  }

  private let connect: @MainActor () async -> Service?
  private let post: @MainActor (AutomationNotice) async -> Void
  private let report: @MainActor (Failure) -> Void
  private var running: Task<Void, Never>?
  private var pullAgain = false
  /// Posted, and not acknowledged as far as this feed knows.
  private var unacknowledged: Set<String> = []

  /// - Parameters:
  ///   - connect: the service's routes, or nil while it is unavailable (the next connection
  ///     pulls again).
  ///   - post: shows one notice; returns once it is shown or cannot be.
  ///   - report: a pull that failed, for the log.
  public init(
    connect: @escaping @MainActor () async -> Service?,
    post: @escaping @MainActor (AutomationNotice) async -> Void,
    report: @escaping @MainActor (Failure) -> Void
  ) {
    self.connect = connect
    self.post = post
    self.report = report
  }

  /// Reads, posts and acknowledges the pending notices, or, while a pull runs, has it run once
  /// more. Returns the pull in progress.
  @discardableResult
  public func pull() -> Task<Void, Never> {
    if let running {
      pullAgain = true
      return running
    }
    let pull = Task {
      repeat {
        pullAgain = false
        await pullOnce()
      } while pullAgain
      running = nil
    }
    running = pull
    return pull
  }

  private func pullOnce() async {
    guard let service = await connect() else { return }
    let notices: [AutomationNotice]
    do {
      notices = try await service.pending()
    } catch {
      return report(.read(error))
    }
    let ids = notices.map(\.id)
    // A notice the service no longer lists was acknowledged or dropped; it cannot come back.
    unacknowledged.formIntersection(ids)
    for notice in notices where !unacknowledged.contains(notice.id) {
      await post(notice)
      unacknowledged.insert(notice.id)
    }
    guard !ids.isEmpty else { return }
    do {
      try await service.acknowledge(ids)
      unacknowledged.subtract(ids)
    } catch {
      report(.acknowledge(error))
    }
  }
}
