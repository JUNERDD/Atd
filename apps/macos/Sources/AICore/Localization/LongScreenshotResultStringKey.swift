/// The long screenshot's own words after the capture (`LongScreenshotController` in AIShell): the
/// short messages its result card's footer buttons show once a copy, an attach or an annotated
/// attach went through or could not, and how an answer ends when the panel's page goes away.
public enum LongScreenshotResultStringKey: String, CaseIterable, ShellCatalogKey {
  case copied = "longScreenshot.result.copied"
  case clipboardBusy = "longScreenshot.result.clipboardBusy"
  case attached = "longScreenshot.result.attached"
  /// The kept image or its context could not be written or imported.
  case exportFailed = "longScreenshot.result.exportFailed"
  /// Even the smallest fallback of the kept image is over the file budget.
  case tooLarge = "longScreenshot.result.tooLarge"
  case answerInterrupted = "longScreenshot.result.answerInterrupted"
}
