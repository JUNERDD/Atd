/// The long screenshot's copy on the command island: its processing capsule and its result card
/// (`IslandLongScreenshotCard` in AIShell). The card's answer slot and Attach share the recording
/// card's copy (``RecordingIslandStringKey``: Send, Stop, the pager, Regenerate, Copy Answer,
/// Restore, Attach to Conversation and the like), since both cards use the same pieces for them.
/// App names, recognized text and answers are runtime data and are never translated.
public enum LongScreenshotCardStringKey: String, CaseIterable, ShellCatalogKey {
  /// The capsule while the long image is prepared for the card.
  case processing = "longScreenshot.card.processing"
  /// The card's VoiceOver name; `%@` is its subtitle.
  case card = "longScreenshot.card.card"
  case title = "longScreenshot.card.title"
  /// The subtitle's screens; `%@` is the count as the live chrome writes it (`2.4`, `12`).
  case screens = "longScreenshot.card.screens"
  /// Appended to the subtitle once either end is trimmed.
  case trimmed = "longScreenshot.card.trimmed"
  case restoreTooltip = "longScreenshot.card.restoreTooltip"
  /// The preview's VoiceOver name.
  case preview = "longScreenshot.card.preview"
  case trimTop = "longScreenshot.card.trimTop"
  case trimBottom = "longScreenshot.card.trimBottom"
  /// The side column's header, and its info tooltip.
  case reads = "longScreenshot.card.reads"
  case readsInfo = "longScreenshot.card.readsInfo"
  /// A page row's label; `%@` is its number.
  case page = "longScreenshot.card.page"
  /// A page with no recognized text.
  case noText = "longScreenshot.card.noText"
  /// What is sent besides the image: `%1$@` is ``lines``, `%2$@` is ``characters``.
  case recognized = "longScreenshot.card.recognized"
  /// `%lld` recognized lines (plural).
  case lines = "longScreenshot.card.lines"
  /// `%lld` recognized characters (plural).
  case characters = "longScreenshot.card.characters"
  /// The sensitive row before covering; `%@` lists the kinds found with their counts.
  case sensitiveFound = "longScreenshot.card.sensitiveFound"
  /// The sensitive row once covered; `%@` lists the same.
  case sensitiveCovered = "longScreenshot.card.sensitiveCovered"
  /// `%lld` of a kind (plural), joined by ``kindSeparator`` in the two rows above.
  case kindEmail = "longScreenshot.card.kind.email"
  case kindPhone = "longScreenshot.card.kind.phone"
  case kindKey = "longScreenshot.card.kind.key"
  case kindCard = "longScreenshot.card.kind.card"
  case kindSeparator = "longScreenshot.card.kindSeparator"
  case cover = "longScreenshot.card.cover"
  case coverTooltip = "longScreenshot.card.coverTooltip"
  // Asking about the long screenshot.
  case askPlaceholder = "longScreenshot.card.askPlaceholder"
  case askLabel = "longScreenshot.card.askLabel"
  /// What an empty field asks.
  case askDefault = "longScreenshot.card.askDefault"
  case quickSummary = "longScreenshot.card.quickSummary"
  case quickTable = "longScreenshot.card.quickTable"
  case quickKeyInfo = "longScreenshot.card.quickKeyInfo"
  /// An answer's range: the kept height; `%@` is the points (`1,234`).
  case keptHeight = "longScreenshot.card.keptHeight"
  // The footer.
  case annotate = "longScreenshot.card.annotate"
  case annotateTooltip = "longScreenshot.card.annotateTooltip"
  case copy = "longScreenshot.card.copy"
  case copyTooltip = "longScreenshot.card.copyTooltip"
  // The full-screen preview (the lightbox): opening it from the card, and its chrome.
  case lightbox = "longScreenshot.card.lightbox"
  case lightboxTooltip = "longScreenshot.card.lightboxTooltip"
  /// The × that closes it, and the Escape hint's label.
  case back = "longScreenshot.card.back"
  case backTooltip = "longScreenshot.card.backTooltip"
  /// The page counter: `%1$@` is the page shown, `%2$@` how many there are.
  case pageOf = "longScreenshot.card.pageOf"
  case previousPage = "longScreenshot.card.previousPage"
  case nextPage = "longScreenshot.card.nextPage"
  case zoomIn = "longScreenshot.card.zoomIn"
  case zoomOut = "longScreenshot.card.zoomOut"
  /// The zoom's percentage, which switches between fitting the width and the actual size.
  case zoomTooltip = "longScreenshot.card.zoomTooltip"
  /// The zoom fits the image's width (for VoiceOver, after the percentage).
  case fit = "longScreenshot.card.fit"
  /// A trim bar's tab; `%@` is where it stands in points (`1,234 pt`).
  case trimStart = "longScreenshot.card.trimStart"
  case trimEnd = "longScreenshot.card.trimEnd"
  /// The bottom bar's key hints.
  case hintScroll = "longScreenshot.card.hintScroll"
  case hintZoom = "longScreenshot.card.hintZoom"
  /// The bottom bar's cover button; `%@` lists the kinds found with their counts.
  case coverKinds = "longScreenshot.card.coverKinds"
  /// The overview rail, and its viewport's tooltip.
  case overview = "longScreenshot.card.overview"
  case viewportTooltip = "longScreenshot.card.viewportTooltip"
  /// Ends annotate mode.
  case done = "longScreenshot.card.done"
  case doneTooltip = "longScreenshot.card.doneTooltip"
}
