import AICore
import Testing
import UserNotifications

@testable import AIShell

/// Stands in for the system's notification center: answers the status it holds, and records
/// permission requests and posted notifications.
@MainActor
private final class FakeCenter: UserNotificationCenter {
  var status: UNAuthorizationStatus
  /// The status a permission request leaves; `.notDetermined` when the prompt was closed.
  var answer: UNAuthorizationStatus = .authorized
  private(set) var requests = 0
  private(set) var added: [String] = []

  init(status: UNAuthorizationStatus) { self.status = status }

  func authorizationStatus() async -> UNAuthorizationStatus { status }

  func requestAuthorization(options: UNAuthorizationOptions) async throws -> Bool {
    requests += 1
    status = answer
    return answer == .authorized
  }

  func add(_ notification: AutomationNotification) async throws {
    added.append(notification.identifier)
  }
}

@MainActor
@Suite("Automation notifier")
struct AutomationNotifierTests {
  static func notice(_ id: String) -> AutomationNotice {
    AutomationNotice(
      id: id, kind: .delivered, automationId: "auto_1", automationName: "Inbox sweep",
      taskId: "task_1", summary: nil, declined: nil, createdAt: "2026-10-06T08:00:00.000Z")
  }

  private func notifier(_ center: FakeCenter) -> AutomationNotifier {
    AutomationNotifier(center: center) { ShellText(language: .english) { $0.rawValue } }
  }

  @Test("Asks for permission on the first notice, not before, then posts")
  func asksLazily() async {
    let center = FakeCenter(status: .notDetermined)
    let notifier = notifier(center)
    #expect(center.requests == 0)
    await notifier.post(Self.notice("a"))
    await notifier.post(Self.notice("b"))
    #expect(center.requests == 1)
    #expect(center.added == ["a", "b"])
  }

  @Test(
    "Without permission nothing is posted, and it asks at most once per launch",
    arguments: [UNAuthorizationStatus.denied, .notDetermined])
  func refused(answer: UNAuthorizationStatus) async {
    let center = FakeCenter(status: .notDetermined)
    center.answer = answer
    let notifier = notifier(center)
    await notifier.post(Self.notice("a"))
    await notifier.post(Self.notice("b"))
    #expect(center.requests == 1)
    #expect(center.added.isEmpty)
  }

  @Test("A decided permission is never asked again", arguments: [true, false])
  func decided(allowed: Bool) async {
    let center = FakeCenter(status: allowed ? .authorized : .denied)
    await notifier(center).post(Self.notice("a"))
    #expect(center.requests == 0)
    #expect(center.added == (allowed ? ["a"] : []))
  }
}
