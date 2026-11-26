/// String Catalog keys for native diagnostics menus, alerts, and `WindowRecoveryView`.
///
/// Adopts ``ShellCatalogKey`` so `ShellStrings.shared.text(_:)` resolves every key without adding
/// per-enum boilerplate in `ShellStrings.swift`.
public enum DiagnosticsStringKey: String, CaseIterable, ShellCatalogKey, Sendable {
  case menuExportDiagnostics = "menu.exportDiagnostics"
  case errorExportDiagnosticsTitle = "error.exportDiagnostics.title"
  case errorExportDiagnosticsMessage = "error.exportDiagnostics.message"

  case exportConfirmTitle = "diagnostics.export.confirmTitle"
  case exportConfirmMessage = "diagnostics.export.confirmMessage"
  case exportIncludeCrashes = "diagnostics.export.includeCrashes"
  case exportSaveButton = "diagnostics.export.saveButton"
  case exportCancelButton = "diagnostics.export.cancelButton"
  case exportPanelBusy = "diagnostics.export.panelBusy"

  case recoveryTitleTimeout = "diagnostics.recovery.title.timeout"
  case recoveryTitleCrashed = "diagnostics.recovery.title.crashed"
  case recoveryBodyServiceFailed = "diagnostics.recovery.body.serviceFailed"
  case recoveryBodyRendererStalled = "diagnostics.recovery.body.rendererStalled"
  case recoveryBodyRendererStalledDev = "diagnostics.recovery.body.rendererStalledDev"
  case recoveryBodyDevHint = "diagnostics.recovery.body.devHint"
  case recoveryBodyDevRendererUnreachable = "diagnostics.recovery.body.devRendererUnreachable"
  case recoveryActionRestartService = "diagnostics.recovery.action.restartService"
  case recoveryActionExportDiagnostics = "diagnostics.recovery.action.exportDiagnostics"
  case recoveryActionReloadPage = "diagnostics.recovery.action.reloadPage"
  case recoveryFeedbackExported = "diagnostics.recovery.feedback.exported"

  /// Convenience alias matching `SystemPanels+Diagnostics` emergency reentrancy error copy.
  public static let exportPanelAlreadyOpen: Self = .exportPanelBusy
}
