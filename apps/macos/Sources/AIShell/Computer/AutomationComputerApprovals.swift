import AICore
import AIRelay
import AppKit

/// `computer.authorizeAutomation`: the native confirmation before an automation may use the
/// computer unattended (D5, D7). The page names the automation and the revision it shows; the
/// shell reads the exact scope from the service with its own token, shows it, and approves with
/// the approval hash it showed, so content that changed in between is refused (`changed`)
/// rather than approved unseen. Shares ``ConfirmationPrompter`` with every other security
/// confirmation, so it never stacks on one.
enum AutomationComputerApprovals {
  typealias Result = ComputerAuthorizeAutomationResult

  /// One authorization at a time.
  private static var pending = false

  static func request(
    _ params: ComputerAuthorizeAutomationParams, services: ShellServices,
    confirmations: ConfirmationPrompter, systemPanels: SystemPanels
  ) async throws(BridgeError) -> Result {
    let isBusy = { pending || confirmations.isShowing || systemPanels.isOpen }
    if isBusy() { return refused(.busy) }
    pending = true
    defer { pending = false }
    guard let client = try? await services.client() else { return refused(.unavailable) }
    do {
      let details = try await client.automationComputerApprovalDetails(
        automationId: params.automationId)
      guard details.automationId == params.automationId,
        details.revision == params.expectedRevision
      else { return refused(.changed) }
      guard details.hasPassedTrial else { return refused(.notQualified) }
      // The details read awaited; another dialog may have opened meanwhile.
      if confirmations.isShowing || systemPanels.isOpen { return refused(.busy) }
      switch await confirm(details, with: confirmations) {
      case nil: return refused(.busy)
      case false?: return refused(.cancelled)
      case true?: break
      }
      switch try await client.approveAutomationComputer(
        automationId: details.automationId, expectedRevision: details.revision,
        approvalHash: details.approvalHash)
      {
      case .approved(let grantId, let version):
        return .approved(.init(grantId: grantId, version: version))
      case .changed:
        return refused(.changed)
      case .notQualified:
        return refused(.notQualified)
      }
    } catch {
      throw BridgeError(ShellBridge.message(error, "The automation could not be authorized."))
    }
  }

  /// Cancel is the default (Return and Escape) in the trailing place, as in every prompt that
  /// grants access: approving lets runs act on this Mac with no one present, so it takes a
  /// deliberate click. Authorize destroys nothing, so it is not drawn as destructive. Nil when
  /// another confirmation showed first.
  private static func confirm(
    _ details: AutomationComputerApprovalDetails, with confirmations: ConfirmationPrompter
  ) async -> Bool? {
    let strings = ShellStrings.shared
    let dialog = AutomationComputerApprovalDialog(details, text: strings.catalog)
    // NSAlert places the first button trailing.
    let prompt = ConfirmationPrompt<Bool>(
      title: dialog.title, message: dialog.message,
      buttons: [
        .init(title: strings.text(.cancel), choice: false, isDefault: true, isCancel: true),
        .init(title: strings.text(.computerApprovalAllow), choice: true),
      ],
      detail: dialog.detail)
    return await confirmations.ask(prompt)
  }

  private static func refused(_ reason: Result.NotApproved.Reason) -> Result {
    .notApproved(.init(reason: reason))
  }
}
