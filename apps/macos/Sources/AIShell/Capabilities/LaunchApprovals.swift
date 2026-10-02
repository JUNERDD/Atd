import AICore
import AIRelay
import AppKit

/// `approval.request`: the native confirmation before an MCP server may launch. The decisions
/// (busy, cooldown, fingerprint, `changed`) are ``McpApprovalGate``'s and the copy is
/// ``McpApprovalDialog``'s; this puts them in a warning alert through the shared
/// ``ConfirmationPrompter``, so it never stacks on another confirmation.
final class LaunchApprovals {
  private let services: ShellServices
  private let gate: McpApprovalGate

  init(services: ShellServices, confirmations: ConfirmationPrompter, systemPanels: SystemPanels) {
    self.services = services
    gate = McpApprovalGate(
      isBusy: { confirmations.isShowing || systemPanels.isOpen },
      confirm: { details in await Self.confirm(details, with: confirmations) },
      now: { .now })
  }

  /// Only `serverId` comes from the page; what the dialog shows and approves is the service's.
  func request(serverId: String) async throws(BridgeError) -> ApprovalRequestResult {
    let services = services
    do {
      return try await gate.request(serverId: serverId) {
        guard let client = try? await services.client() else { return nil }
        return McpApprovalGate.Service(client: client)
      }
    } catch {
      throw BridgeError(ShellBridge.message(error, "The launch could not be approved."))
    }
  }

  /// Cancel is the default and the Escape answer; Allow to Run is drawn as destructive.
  private static func confirm(
    _ details: McpLaunchApprovalDetails, with confirmations: ConfirmationPrompter
  ) async -> McpApprovalGate.Answer {
    let strings = ShellStrings.shared
    let dialog = McpApprovalDialog(details, text: strings.catalog)
    let prompt = ConfirmationPrompt<McpApprovalGate.Answer>(
      title: dialog.title, message: dialog.message,
      buttons: [
        .init(title: strings.text(.cancel), choice: .cancel, isDefault: true, isCancel: true),
        .init(title: strings.text(.mcpApprovalAllow), choice: .allow, isDestructive: true),
      ],
      detail: dialog.detail)
    return await confirmations.ask(prompt) ?? .notShown
  }
}
