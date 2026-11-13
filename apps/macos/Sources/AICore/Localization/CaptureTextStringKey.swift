/// Commands on text recognized in a screenshot (the capture editor's text mode and the long
/// screenshot's full-screen preview): the scope chip, the result card's notes and actions, its
/// copied capsule, the long screenshot's summary row, and the Annotate output's name. Both surfaces share them, so they
/// live apart from either surface's own keys. Command names, answers and recognized text are user
/// data and never pass through here.
public enum CaptureTextStringKey: String, CaseIterable, ShellCatalogKey {
  /// The output choice that marks the screenshot (numbered steps, highlighter).
  case outputAnnotate = "commandOptions.output.annotate"

  /// One `%lld`, the paragraphs picked, with plural variations: the scope chip.
  case scopePicked = "captureText.scope.picked"
  /// One `%lld`, the paragraphs recognized, with plural variations: the scope chip with none
  /// picked.
  case scopeAll = "captureText.scope.all"
  /// The scope note when Ask Atd runs on the screenshot outside text mode, or on an image with no
  /// recognized text.
  case scopeScreenshot = "captureText.scope.screenshot"
  /// The scope chip's ×: clears what is picked.
  case scopeClear = "captureText.scope.clear"

  /// One `%@`, the scope chip's words: the run is reading what it reads.
  case noteReading = "captureText.note.reading"
  /// The answer is being written.
  case noteWriting = "captureText.note.writing"
  /// Two `%lld`: paragraphs replaced so far, paragraphs the run reads.
  case noteReplacing = "captureText.note.replacing"
  /// One `%lld`, with plural variations: paragraphs replaced in place.
  case noteReplaced = "captureText.note.replaced"
  /// One `%@`, the step numbers (`1–4`): the notes for them are on the card.
  case noteSteps = "captureText.note.steps"
  /// One `%lld`, with plural variations: highlighter marks drawn.
  case noteHighlights = "captureText.note.highlights"
  /// One `%lld`, with plural variations: visual shape marks drawn (boxes, ellipses, arrows, spotlights).
  case noteMarked = "captureText.note.marked"
  /// One `%lld`, with plural variations: mosaic redactions drawn.
  case noteRedacted = "captureText.note.redacted"
  /// The answer stays on the card; the screenshot did not change.
  case noteUnchanged = "captureText.note.unchanged"
  /// A copy output: the answer is on the clipboard.
  case noteCopied = "captureText.note.copied"
  /// The run finished without anything to put on the screenshot.
  case noteNothing = "captureText.note.nothing"
  /// The run's result was taken off the screenshot again; Reapply puts it back.
  case noteRestored = "captureText.note.restored"
  /// Two `%lld`: the version shown and how many there are, while a replacement waits for review.
  case noteReview = "captureText.note.review"
  /// Two `%lld`: the version shown and how many there are, while steps or highlighter marks wait
  /// for review.
  case noteReviewMarks = "captureText.note.reviewMarks"
  /// One `%lld`, with plural variations: the paragraphs a run reads when one run cannot take its
  /// whole scope.
  case noteCovered = "captureText.note.covered"
  /// One `%lld`, the number of the version being made: the version shown stays meanwhile.
  case noteMaking = "captureText.note.making"
  /// The latest attempt at another version made none; the version shown stays.
  case noteVersionFailed = "captureText.note.versionFailed"
  case noteStopped = "captureText.note.stopped"
  case noteFailed = "captureText.note.failed"

  /// Takes the run's result off the screenshot.
  case revert = "captureText.action.revert"
  case revertTooltip = "captureText.action.revertTooltip"
  /// Puts the result Restore took off back on the screenshot.
  case reapply = "captureText.action.reapply"
  case reapplyTooltip = "captureText.action.reapplyTooltip"
  /// Copies the screenshot with its changes, keeping it open.
  case copyScreenshot = "captureText.action.copyScreenshot"
  case copyScreenshotTooltip = "captureText.action.copyScreenshotTooltip"
  /// Copy's tooltip on an explanation's card: it copies the notes, not the image.
  case copyNotesTooltip = "captureText.action.copyNotesTooltip"
  /// A result under review goes onto the screenshot.
  case apply = "captureText.action.apply"
  /// Escape's hint while a result waits for review, and the lightbox side panel's button before
  /// Apply: nothing goes onto the screenshot.
  case discard = "captureText.action.discard"
  /// ⌥'s hint: the original text shows while it is held.
  case original = "captureText.hint.original"
  /// A numbered item whose step marker was deleted from the screenshot.
  case itemGone = "captureText.item.gone"

  /// One `%lld`, with plural variations: the long screenshot summary row's translated paragraphs.
  case dockTranslations = "captureText.dock.translations"
  /// One `%lld`, with plural variations: the long screenshot summary row's step markers.
  case dockSteps = "captureText.dock.steps"
  /// One `%lld`, with plural variations: the long screenshot summary row's highlighter marks.
  case dockHighlights = "captureText.dock.highlights"
  /// One `%lld`, with plural variations: the long screenshot summary row's visual shape marks.
  case dockMarks = "captureText.dock.marks"
  /// One `%lld`, with plural variations: the long screenshot summary row's mosaic redactions.
  case dockRedactions = "captureText.dock.redactions"
  /// The long screenshot summary row while a run reads and nothing has landed yet.
  case dockReading = "captureText.dock.reading"
  /// The long screenshot summary row's Restore: every AI change on the screenshot goes.
  case dockRevertTooltip = "captureText.dock.revertTooltip"

  /// The copied capsule after Copy Screenshot.
  case copiedScreenshot = "captureText.copied.screenshot"
  /// One `%@`, the copied image's size (`1040 × 760`): the copied capsule after Copy Screenshot.
  case copiedScreenshotSize = "captureText.copied.screenshotSize"
  /// One `%lld`, with plural variations: the copied capsule after copying picked text.
  case copiedText = "captureText.copied.text"

  /// A run ended before the page had it: its screenshot or context could not be written or
  /// imported.
  case failedExport = "captureText.failed.export"
  /// A run ended because the panel's page went away.
  case failedInterrupted = "captureText.failed.interrupted"
}
