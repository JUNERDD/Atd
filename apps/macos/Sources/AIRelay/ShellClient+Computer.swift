import AICore
import Foundation

/// What `POST /v1/admin/approvals/automation-computer` did.
public enum AutomationComputerApproveOutcome: Equatable, Sendable {
  case approved(grantId: String, version: Int)
  /// The revision or the approval hash moved on since the details were read (409
  /// `approval_changed`).
  case changed
  /// No passed trial matches the current content (409 `conflict`).
  case notQualified
}

extension ShellClient {
  /// `POST /v1/computer/bindings`, shell only: registers the target the host prepared (or updates
  /// the binding the request names) and answers the stored binding. Preparing reaches the service
  /// only through here, with the shell's own token; the page cannot write a binding's content.
  public func saveComputerBinding(_ request: SaveComputerBindingRequestWire) async throws
    -> TargetBindingWire
  {
    let response = try await send(
      "POST", "/v1/computer/bindings", body: try JSONEncoder().encode(request),
      contentType: "application/json", timeout: 15)
    return try JSONDecoder().decode(SavedBinding.self, from: response.data).binding
  }

  /// The bindings `GET /v1/computer` lists.
  public func computerBindings() async throws -> [TargetBindingWire] {
    let response = try await send("GET", "/v1/computer", timeout: 15)
    return try JSONDecoder().decode(BindingList.self, from: response.data).bindings
  }

  /// `GET /v1/admin/approvals/automation-computer/:automationId`, shell only: the exact scope a
  /// grant would approve.
  public func automationComputerApprovalDetails(automationId: String) async throws
    -> AutomationComputerApprovalDetails
  {
    guard !automationId.isEmpty else {
      throw ShellClientError.invalidArgument("The automation id is empty.")
    }
    let response = try await send(
      "GET",
      "/v1/admin/approvals/automation-computer/\(RelayPath.encodeSegment(automationId))")
    return try JSONDecoder().decode(AutomationComputerApprovalDetails.self, from: response.data)
  }

  /// `POST /v1/admin/approvals/automation-computer`: approves what the shell showed, named by
  /// its revision and approval hash. A 409 `approval_changed` is `changed`, a 409 `conflict`
  /// (no matching passed trial) `notQualified`.
  public func approveAutomationComputer(
    automationId: String, expectedRevision: Int, approvalHash: String
  ) async throws -> AutomationComputerApproveOutcome {
    let body = try JSONEncoder().encode(
      ApproveRequest(
        automationId: automationId, expectedRevision: expectedRevision,
        approvalHash: approvalHash))
    let response: Response
    do {
      response = try await send(
        "POST", "/v1/admin/approvals/automation-computer", body: body,
        contentType: "application/json")
    } catch ShellClientError.http(let status, let code, let message) {
      switch (status, code) {
      case (409, "approval_changed"): return .changed
      case (409, "conflict"): return .notQualified
      default: throw ShellClientError.http(status: status, code: code, message: message)
      }
    }
    let grant = try JSONDecoder().decode(ApproveResponse.self, from: response.data).grant
    return .approved(grantId: grant.grantId, version: grant.version)
  }

  private struct SavedBinding: Decodable {
    let binding: TargetBindingWire
  }

  /// The part of `ComputerStatusResponseSchema` the shell reads.
  private struct BindingList: Decodable {
    let bindings: [TargetBindingWire]
  }

  private struct ApproveRequest: Encodable {
    let automationId: String
    let expectedRevision: Int
    let approvalHash: String
  }

  private struct ApproveResponse: Decodable {
    struct Grant: Decodable {
      let grantId: String
      let version: Int
    }
    let grant: Grant
  }
}
