import AICore
import Foundation

/// The shell-only notice routes the notifications pull and acknowledge, and the confirm route a
/// notification's Reply or Deny answers.
nonisolated extension ShellClient {
  /// `GET /v1/automation-notices`: the automation notices nobody acknowledged yet, oldest first,
  /// checked against the contract while decoding.
  public func automationNotices() async throws -> [AutomationNotice] {
    try JSONDecoder().decode(
      AutomationNoticesResponse.self, from: try await send("GET", "/v1/automation-notices").data
    ).notices
  }

  /// `POST /v1/automation-notices/ack { ids }`: notices the shell is done with, shown or not. The
  /// service ignores ids it no longer has.
  public func acknowledgeAutomationNotices(ids: [String]) async throws {
    try await acknowledge(ids, maxPending: AutomationNotice.maxPending, route: "automation-notices")
  }

  /// `GET /v1/task-notices`: the task notices nobody acknowledged yet, oldest first, checked
  /// against the contract while decoding.
  public func taskNotices() async throws -> [TaskNotice] {
    try JSONDecoder().decode(
      TaskNoticesResponse.self, from: try await send("GET", "/v1/task-notices").data
    ).notices
  }

  /// `POST /v1/task-notices/ack { ids }`: notices the shell is done with, shown or not.
  public func acknowledgeTaskNotices(ids: [String]) async throws {
    try await acknowledge(ids, maxPending: TaskNotice.maxPending, route: "task-notices")
  }

  /// `POST /v1/confirms { requestId, revision, answer }`: answers a pending request. A request
  /// already answered, gone, or at a newer revision fails with the service's error.
  public func replyToConfirm(_ reply: ConfirmReply) async throws {
    _ = try await send(
      "POST", "/v1/confirms", body: try JSONEncoder().encode(reply),
      contentType: "application/json")
  }

  private func acknowledge(_ ids: [String], maxPending: Int, route: String) async throws {
    guard (1...maxPending).contains(ids.count) else {
      throw ShellClientError.invalidArgument("Acknowledge takes 1 to \(maxPending) notice ids.")
    }
    let body = try JSONEncoder().encode(["ids": ids])
    _ = try await send("POST", "/v1/\(route)/ack", body: body, contentType: "application/json")
  }
}

extension NoticeFeed.Service where Notice == AutomationNotice {
  /// The automation feed's routes through the shell's own client.
  public init(client: ShellClient) {
    self.init(
      pending: { try await client.automationNotices() },
      acknowledge: { try await client.acknowledgeAutomationNotices(ids: $0) })
  }
}

extension NoticeFeed.Service where Notice == TaskNotice {
  /// The task feed's routes through the shell's own client.
  public init(client: ShellClient) {
    self.init(
      pending: { try await client.taskNotices() },
      acknowledge: { try await client.acknowledgeTaskNotices(ids: $0) })
  }
}
