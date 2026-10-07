import Foundation
import Testing

@testable import AICore

@MainActor
@Suite("Automation notice feed")
final class AutomationNoticeFeedTests {
  struct Refused: Error {}

  /// What the service lists; an acknowledgement removes what it names.
  var pending: [AutomationNotice] = []
  var online = true
  var failReads = false
  var failAcks = false
  /// Notices the poster cannot show (notifications not allowed).
  var unshowable: Set<String> = []
  /// While true, reads wait for ``release()``.
  var holdReads = false
  private var held: [CheckedContinuation<Void, Never>] = []
  private(set) var reads = 0
  /// Posts and acknowledgements, in order.
  private(set) var log: [String] = []
  private(set) var failures: [String] = []
  private(set) var feed: AutomationNoticeFeed!

  init() {
    feed = AutomationNoticeFeed(
      connect: { [unowned self] in online ? service : nil },
      post: { [unowned self] notice in
        log.append((unshowable.contains(notice.id) ? "unshown " : "shown ") + notice.id)
      },
      report: { [unowned self] failure in
        switch failure {
        case .read: failures.append("read")
        case .acknowledge: failures.append("acknowledge")
        }
      })
  }

  static func notice(_ id: String) -> AutomationNotice {
    AutomationNotice(
      id: id, kind: .delivered, automationId: "auto_1", automationName: "Inbox sweep",
      taskId: "task_\(id)", summary: nil, declined: nil, createdAt: "2026-10-06T08:00:00.000Z")
  }

  private var service: AutomationNoticeFeed.Service {
    AutomationNoticeFeed.Service(
      pending: { [weak self] in try await self?.read() ?? [] },
      acknowledge: { [weak self] ids in try await self?.acknowledge(ids) })
  }

  private func read() async throws -> [AutomationNotice] {
    reads += 1
    if holdReads { await withCheckedContinuation { held.append($0) } }
    if failReads { throw Refused() }
    return pending
  }

  private func acknowledge(_ ids: [String]) throws {
    log.append("ack " + ids.joined(separator: " "))
    if failAcks { throw Refused() }
    pending.removeAll { ids.contains($0.id) }
  }

  private func release() {
    holdReads = false
    let waiting = held
    held = []
    for continuation in waiting { continuation.resume() }
  }

  /// Lets the feed's task run until `condition` holds, for at most five seconds.
  private func eventually(_ condition: () -> Bool) async -> Bool {
    let deadline = ContinuousClock.now + .seconds(5)
    while !condition(), ContinuousClock.now < deadline {
      try? await Task.sleep(for: .milliseconds(2))
    }
    return condition()
  }

  @Test("Posts each pending notice, then acknowledges them all in one request")
  func postsThenAcknowledges() async {
    pending = [Self.notice("a"), Self.notice("b")]
    await feed.pull().value
    #expect(log == ["shown a", "shown b", "ack a b"])
    #expect(failures.isEmpty && pending.isEmpty)
    await feed.pull().value
    #expect(reads == 2 && log.count == 3)
  }

  @Test("Acknowledges a notice it could not show, so it does not come back")
  func acknowledgesUnshown() async {
    unshowable = ["a"]
    pending = [Self.notice("a"), Self.notice("b")]
    await feed.pull().value
    #expect(log == ["unshown a", "shown b", "ack a b"])
    #expect(pending.isEmpty)
  }

  @Test("Reads nothing while the service is unavailable, and an empty list is not acknowledged")
  func offlineAndEmpty() async {
    online = false
    await feed.pull().value
    #expect(reads == 0)
    online = true
    await feed.pull().value
    #expect(reads == 1 && log.isEmpty && failures.isEmpty)
  }

  @Test("A burst of pulls during a pull runs exactly one more")
  func coalesces() async {
    holdReads = true
    pending = [Self.notice("a")]
    let first = feed.pull()
    #expect(await eventually { reads == 1 })
    for _ in 0..<5 { #expect(feed.pull() == first) }
    release()
    await first.value
    #expect(reads == 2)
    #expect(log == ["shown a", "ack a"])
    await feed.pull().value
    #expect(reads == 3)
  }

  @Test("A failed acknowledgement neither loses nor repeats a notice")
  func acknowledgementFails() async {
    pending = [Self.notice("a")]
    failAcks = true
    await feed.pull().value
    #expect(log == ["shown a", "ack a"])
    #expect(failures == ["acknowledge"])
    failAcks = false
    pending.append(Self.notice("b"))
    await feed.pull().value
    #expect(log == ["shown a", "ack a", "shown b", "ack a b"])
    #expect(pending.isEmpty)
  }

  @Test("A failed read shows and acknowledges nothing until a later pull")
  func readFails() async {
    pending = [Self.notice("a")]
    failReads = true
    await feed.pull().value
    #expect(log.isEmpty && failures == ["read"])
    failReads = false
    await feed.pull().value
    #expect(log == ["shown a", "ack a"])
  }
}
