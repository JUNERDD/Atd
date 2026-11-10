/// The long screenshot's live chrome beside the selection (`LongScreenshotChrome` in AIShell):
/// the control bar, the status row under it and the preview strip. Back and Done keep the
/// capture copy (`capture.hint.back`, `capture.confirm`), and tooltips the capture form
/// (`capture.tooltip.shortcut`); keys named in them (Space, Esc, ↩) are not translated.
public enum LongScreenshotChromeStringKey: String, CaseIterable, ShellCatalogKey {
  /// The control bar's VoiceOver name.
  case bar = "longScreenshot.chrome.bar"
  /// The auto-scroll toggle while Atd is not scrolling.
  case autoScroll = "longScreenshot.chrome.autoScroll"
  /// The auto-scroll toggle while Atd is scrolling.
  case pauseScroll = "longScreenshot.chrome.pauseScroll"
  /// How much is stitched; `%@` is the number of screens with one decimal (`2.4`), or a whole
  /// number from ten.
  case captured = "longScreenshot.chrome.captured"
  /// The status row's VoiceOver name.
  case statusRow = "longScreenshot.chrome.statusRow"
  /// Before the page first moves.
  case messageStart = "longScreenshot.chrome.message.start"
  /// The newest frame no longer overlaps what is stitched.
  case messageLost = "longScreenshot.chrome.message.lost"
  /// The page's end is in the image.
  case messageEnd = "longScreenshot.chrome.message.end"
  /// The status row's toggle, beside ``messageEnd``, that adds the scroll area's part below the
  /// selection to the image (or takes it out again).
  case includeTail = "longScreenshot.chrome.includeTail"
  /// That toggle's tooltip.
  case includeTailTooltip = "longScreenshot.chrome.includeTail.tooltip"
  /// Auto-scroll was asked for without the permission to post scroll events.
  case messageNeedsPermission = "longScreenshot.chrome.message.needsPermission"
  /// The image is as long as it can be; it grows no further.
  case messageLimit = "longScreenshot.chrome.message.limit"
  /// The preview strip's VoiceOver name.
  case strip = "longScreenshot.chrome.strip"
  /// The strip's caption: `%1$@` screens as ``captured`` writes them, `%2$@` the image's height
  /// in points (`1,234`).
  case stripCaption = "longScreenshot.chrome.strip.caption"
  /// The strip's caption while stitching waits for the user to scroll back.
  case stripLost = "longScreenshot.chrome.strip.lost"
}
