/// The long screenshot's full-screen preview working on its recognized text (the plan's
/// 「长截图的全屏预览」): Select Text and its text mode, the marquee's count, the text command
/// row docked above the bottom bar, and the top bar's toggle of the side panel with the result.
/// The scope chip and the result card share the capture editor's words
/// (``CaptureTextStringKey``). Command names and recognized text are user data and never pass
/// through here.
public enum LongScreenshotTextStringKey: String, CaseIterable, ShellCatalogKey {
  /// The bottom bar's first button, which enters text mode.
  case select = "longScreenshot.text.select"
  case selectTooltip = "longScreenshot.text.selectTooltip"
  /// The same button's tooltip in text mode, where it reads Done and leaves the mode.
  case doneTooltip = "longScreenshot.text.doneTooltip"
  /// The bottom bar's key hints in text mode: a drag boxes paragraphs, Space held pans, Escape
  /// leaves.
  case hintMarquee = "longScreenshot.text.hint.marquee"
  case hintPan = "longScreenshot.text.hint.pan"
  case hintExit = "longScreenshot.text.hint.exit"
  /// One `%lld`, with plural variations: the paragraphs picked, on the badge beside a marquee's
  /// pointer.
  case marqueeCount = "longScreenshot.text.marqueeCount"
  /// The text command row, for VoiceOver.
  case row = "longScreenshot.text.row"
  /// One `%@`, the command's name: a command button's tooltip.
  case runTooltip = "longScreenshot.text.runTooltip"
  /// The row's Copy: the picked text, without AI.
  case copyTooltip = "longScreenshot.text.copyTooltip"
  /// A command button's VoiceOver value while its run reads.
  case running = "longScreenshot.text.running"
  /// The top bar's toggle of the side panel with the result, and its tooltip with its shortcut.
  case results = "longScreenshot.text.results"
  case resultsTooltip = "longScreenshot.text.resultsTooltip"
}
