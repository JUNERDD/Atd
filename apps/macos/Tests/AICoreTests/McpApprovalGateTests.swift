import Foundation
import Testing

@testable import AICore

@MainActor
@Suite("MCP launch approval gate")
final class McpApprovalGateTests {
  struct Unreachable: Error {}

  var details: McpLaunchApprovalDetails
  var answer: McpApprovalGate.Answer = .allow
  var busy = false
  var approveOutcome: McpLaunchApproveOutcome = .approved
  var clock = ContinuousClock.now
  private(set) var shown: [String] = []
  private(set) var fetched: [String] = []
  private(set) var approvals: [McpLaunchApproveRequest] = []
  /// Runs while the dialog would be up.
  var duringDialog: (() async -> Void)?

  private(set) var gate: McpApprovalGate!

  init() throws {
    details = try McpApprovalDialogTests.details(McpApprovalDialogTests.stdioJSON)
    gate = McpApprovalGate(
      isBusy: { [unowned self] in busy },
      confirm: { [unowned self] details in
        shown.append(details.fingerprint)
        await duringDialog?()
        return answer
      },
      now: { [unowned self] in clock })
  }

  func request(_ serverId: String = "notes", online: Bool = true) async throws
    -> ApprovalRequestResult
  {
    try await gate.request(serverId: serverId) { online ? service : nil }
  }

  /// Answers from the test's state; records what the gate asked for.
  private var service: McpApprovalGate.Service {
    let details = details
    let outcome = approveOutcome
    return McpApprovalGate.Service(
      details: { [weak self] serverId in
        await MainActor.run { self?.fetched.append(serverId) }
        return details
      },
      approve: { [weak self] request in
        await MainActor.run { self?.approvals.append(request) }
        return outcome
      })
  }

  static let approved = ApprovalRequestResult.approved(.init())
  static func refused(_ reason: ApprovalRequestResult.NotApproved.Reason) -> ApprovalRequestResult {
    .notApproved(.init(reason: reason))
  }

  @Test("Allow approves with the fingerprint shown, via the shell")
  func allow() async throws {
    #expect(try await request() == Self.approved)
    #expect(fetched == ["notes"])
    #expect(shown == [details.fingerprint])
    #expect(approvals == [McpLaunchApproveRequest(approving: details)])
    #expect(approvals.first?.fingerprint == details.fingerprint && approvals.first?.via == "shell")
  }

  @Test("A launch that changed before the approve answers changed")
  func changed() async throws {
    approveOutcome = .changed
    #expect(try await request() == Self.refused(.changed))
  }

  @Test("Cancel sends nothing and refuses the same launch for 30 seconds without a dialog")
  func cancelCooldown() async throws {
    answer = .cancel
    #expect(try await request() == Self.refused(.cancelled))
    #expect(approvals.isEmpty && shown.count == 1)
    clock += .seconds(29)
    #expect(try await request() == Self.refused(.cancelled))
    #expect(shown.count == 1)
    clock += .seconds(2)
    #expect(try await request() == Self.refused(.cancelled))
    #expect(shown.count == 2)
    #expect(approvals.isEmpty)
  }

  @Test("The cooldown holds only the cancelled fingerprint and server")
  func cooldownScope() async throws {
    answer = .cancel
    _ = try await request()
    #expect(try await request("other") == Self.refused(.cancelled))
    #expect(shown.count == 2)
    details = try McpApprovalDialogTests.details(
      McpApprovalDialogTests.stdioJSON.replacingOccurrences(
        of: McpApprovalDialogTests.fingerprint, with: String(repeating: "b2", count: 32)))
    answer = .allow
    #expect(try await request() == Self.approved)
    #expect(shown.count == 3)
  }

  @Test("Another dialog or a request in progress answers busy without a dialog")
  func busyAnswers() async throws {
    busy = true
    #expect(try await request() == Self.refused(.busy))
    #expect(fetched.isEmpty && shown.isEmpty)
    busy = false
    var nested: ApprovalRequestResult?
    duringDialog = { [unowned self] in nested = try? await request() }
    #expect(try await request() == Self.approved)
    #expect(nested == Self.refused(.busy))
    duringDialog = nil
    answer = .notShown
    #expect(try await request() == Self.refused(.busy))
    #expect(approvals.count == 1)
  }

  @Test("A dialog that opened during the details read makes it busy")
  func busyAfterRead() async throws {
    let gate = McpApprovalGate(
      isBusy: { [unowned self] in !fetched.isEmpty },
      confirm: { _ in .allow }, now: { .now })
    let result = try await gate.request(serverId: "notes") { service }
    #expect(result == Self.refused(.busy))
    #expect(approvals.isEmpty)
  }

  @Test("No service answers unavailable; an approved launch needs no dialog")
  func unavailableAndApproved() async throws {
    #expect(try await request(online: false) == Self.refused(.unavailable))
    details = try McpApprovalDialogTests.details(
      McpApprovalDialogTests.stdioJSON.replacingOccurrences(of: "required", with: "approved"))
    #expect(try await request() == Self.approved)
    #expect(shown.isEmpty && approvals.isEmpty)
  }

  @Test("A failed details read rejects the call")
  func failedRead() async throws {
    let gate = McpApprovalGate(isBusy: { false }, confirm: { _ in .allow }, now: { .now })
    let failing = McpApprovalGate.Service(
      details: { _ in throw Unreachable() }, approve: { _ in .approved })
    await #expect(throws: Unreachable.self) {
      try await gate.request(serverId: "notes") { failing }
    }
  }
}
