/// The screenshot's command row, ask field, Copy text and auto-redact keys (architecture S1–S6),
/// kept with their independently owned surface. Command names are user data and never pass
/// through here.
public enum CaptureCommandsStringKey: String, CaseIterable, Sendable {
  /// The command row's VoiceOver name.
  case captureCommandsLabel = "capture.commands.label"
  /// Ask Atd's tooltip, before its shortcut.
  case captureCommandsAskTooltip = "capture.commands.askTooltip"
  /// One `%@`: the command's name.
  case captureCommandsRunTooltip = "capture.commands.runTooltip"
  case captureCommandsMoreTooltip = "capture.commands.moreTooltip"
  /// More's last row: opens Settings › Commands.
  case captureCommandsCustomize = "capture.commands.customize"
  case captureCommandsCopyText = "capture.commands.copyText"
  case captureCommandsCopyTextTooltip = "capture.commands.copyTextTooltip"
  /// Copy text's confirmation in place of its label.
  case captureCommandsCopied = "capture.commands.copied"
  /// One `%lld`, the lines copied, with plural variations: the tooltip and announcement.
  case captureCommandsCopiedLines = "capture.commands.copiedLines"
  case captureCommandsNoText = "capture.commands.noText"
  case captureCommandsNoTextDetail = "capture.commands.noTextDetail"
  case captureCommandsAskPlaceholder = "capture.commands.askPlaceholder"
  /// The question sent when the screenshot's Ask field is empty.
  case captureCommandsAskDefault = "capture.commands.askDefault"
  case captureCommandsSend = "capture.commands.send"
  /// One `%lld`, with plural variations: the auto-redact button.
  case captureRedactAction = "capture.redact.action"
  /// One `%lld`, with plural variations: the auto-redact button's confirmation.
  case captureRedactDone = "capture.redact.done"
  case captureRedactAllCovered = "capture.redact.allCovered"
  case captureRedactNone = "capture.redact.none"
  case captureRedactScanning = "capture.redact.scanning"
  case captureRedactTooltip = "capture.redact.tooltip"
  /// Follows the confirmation in its tooltip and announcement.
  case captureRedactUndoHint = "capture.redact.undoHint"
  /// One `%lld`, with plural variations: the mosaic tool's tooltip while text is unmasked.
  case captureRedactFound = "capture.redact.found"
}
