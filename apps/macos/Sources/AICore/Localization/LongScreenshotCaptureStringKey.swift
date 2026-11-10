/// The long screenshot's copy in the capture session (decision D7): the screenshot toolbar's
/// button and why it is off, the bottom bar's labels and the live phase's size label. The keys to
/// press are drawn as keycaps and are not translated; the live phase's Done and Back keep
/// `capture.confirm` and `capture.hint.back`.
public enum LongScreenshotCaptureStringKey: String, CaseIterable, ShellCatalogKey {
  /// The toolbar button's name, and the bottom bar's label after the ⌘↓ keycap.
  case name = "longScreenshot.capture.name"
  /// The button's tooltip while the selection offers it; the shortcut follows it.
  case tooltipAvailable = "longScreenshot.capture.tooltip.available"
  /// The button's tooltip while Accessibility looks for scrolling content under the selection.
  case tooltipChecking = "longScreenshot.capture.tooltip.checking"
  /// The button's tooltip when nothing under the selection scrolls.
  case tooltipNotScrollable = "longScreenshot.capture.tooltip.notScrollable"
  /// The button's tooltip when the selection reaches over more than one display.
  case tooltipSpansDisplays = "longScreenshot.capture.tooltip.spansDisplays"
  /// The live phase's bottom bar after the Space keycap while Atd does not scroll the page.
  case barAutoScroll = "longScreenshot.capture.bar.autoScroll"
  /// The same place while Atd scrolls the page.
  case barPauseScroll = "longScreenshot.capture.bar.pauseScroll"
  /// The live phase's size label: `%@` is "W × H" in points of the stitched image.
  case sizeLabel = "longScreenshot.capture.sizeLabel"
}
