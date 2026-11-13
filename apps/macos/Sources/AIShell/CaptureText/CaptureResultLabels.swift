import AICore
import Foundation

/// The screenshot text command's result card in the shell language: the island's words for what
/// the two result cards share (Copy, Copied, Close, Open in Atd, Insert, the review card's), and
/// the card's own (``CaptureTextStringKey``). Built again when the language changes.
struct CaptureResultLabels: Equatable {
  var island = IslandLabels()
  /// The language the labels are in; a change rebuilds them, and the views reading them.
  var language = ShellLanguage.english

  static func current() -> Self {
    Self(island: .current(), language: ShellStrings.shared.language)
  }

  private var text: ShellText { ShellStrings.shared.catalog }

  /// The scope chip's words: `所选 · 2 段`, `全部文字 · 14 段`, or `当前截图`.
  func scope(_ scope: CaptureTextScope) -> String {
    switch scope.kind {
    case .picked: text(CaptureTextStringKey.scopePicked, scope.count)
    case .all: text(CaptureTextStringKey.scopeAll, scope.count)
    case .screenshot: text(CaptureTextStringKey.scopeScreenshot)
    }
  }

  /// The note under the card's title: what it read (and how much of it, when one run could not
  /// take it all), then where the result went.
  func note(_ card: CaptureResultCard) -> String {
    let covered = card.covered.map { text(CaptureTextStringKey.noteCovered, $0) }
    let scope = ([scope(card.scope)] + [covered].compactMap(\.self)).joined(separator: " · ")
    switch card.notes.first {
    case .reading: return text(CaptureTextStringKey.noteReading, scope)
    case .writing:
      return ([text(CaptureTextStringKey.noteWriting)] + [covered].compactMap(\.self))
        .joined(separator: " · ")
    case .making(let version):
      return ([text(CaptureTextStringKey.noteMaking, version)] + [covered].compactMap(\.self))
        .joined(separator: " · ")
    case nil: return scope
    default: return ([scope] + card.notes.map(phrase)).joined(separator: " · ")
    }
  }

  private func phrase(_ note: CaptureResultCard.Note) -> String {
    switch note {
    case .reading, .writing, .making: ""
    case .replacing(let done, let total): text(CaptureTextStringKey.noteReplacing, done, total)
    case .replaced(let count): text(CaptureTextStringKey.noteReplaced, count)
    case .steps(let first, let last):
      text(CaptureTextStringKey.noteSteps, first == last ? "\(first)" : "\(first)–\(last)")
    case .highlights(let count): text(CaptureTextStringKey.noteHighlights, count)
    case .marked(let count): text(CaptureTextStringKey.noteMarked, count)
    case .redacted(let count): text(CaptureTextStringKey.noteRedacted, count)
    case .unchanged: text(CaptureTextStringKey.noteUnchanged)
    case .copied: text(CaptureTextStringKey.noteCopied)
    case .nothing: text(CaptureTextStringKey.noteNothing)
    case .restored: text(CaptureTextStringKey.noteRestored)
    case .review(let version, let count): text(CaptureTextStringKey.noteReview, version, count)
    case .reviewMarks(let version, let count):
      text(CaptureTextStringKey.noteReviewMarks, version, count)
    case .versionFailed: text(CaptureTextStringKey.noteVersionFailed)
    case .stopped: text(CaptureTextStringKey.noteStopped)
    case .failed: text(CaptureTextStringKey.noteFailed)
    }
  }

  /// What the long screenshot's summary row says: what is on the image, or the run in progress.
  func dock(_ summary: CaptureTextDockSummary) -> String {
    var parts: [String] = []
    switch summary.running {
    case .replacing(let done, let total):
      parts.append(text(CaptureTextStringKey.noteReplacing, done, total))
    case .reading, nil:
      if summary.translations > 0 {
        parts.append(text(CaptureTextStringKey.dockTranslations, summary.translations))
      }
    }
    if summary.steps > 0 { parts.append(text(CaptureTextStringKey.dockSteps, summary.steps)) }
    if summary.highlights > 0 {
      parts.append(text(CaptureTextStringKey.dockHighlights, summary.highlights))
    }
    if summary.marks > 0 { parts.append(text(CaptureTextStringKey.dockMarks, summary.marks)) }
    if summary.redactions > 0 {
      parts.append(text(CaptureTextStringKey.dockRedactions, summary.redactions))
    }
    if summary.running == .reading { parts.append(text(CaptureTextStringKey.dockReading)) }
    return parts.joined(separator: " · ")
  }

  /// A footer hint's keys and words.
  func hint(_ hint: CaptureResultCard.Hint) -> (keys: String, label: String) {
    switch hint {
    case .stop: ("esc", island.review.stop)
    case .close: ("esc", island.close)
    case .discard: ("esc", text(CaptureTextStringKey.discard))
    case .original: ("⌥", text(CaptureTextStringKey.original))
    }
  }

  /// A footer action's title.
  func title(_ action: CaptureResultCard.Action) -> String {
    switch action {
    case .revert: text(CaptureTextStringKey.revert)
    case .reapply: text(CaptureTextStringKey.reapply)
    case .copy: island.copy
    case .copyScreenshot: text(CaptureTextStringKey.copyScreenshot)
    case .open: island.openInAtd
    case .insert: island.insert
    case .apply: text(CaptureTextStringKey.apply)
    }
  }

  /// A footer action's tooltip and VoiceOver hint, with its keys (``keys(_:primary:)``) where
  /// the card shows them; `insertApp` names the app Insert writes into, and `notes` says Copy
  /// copies an explanation's notes rather than an answer.
  func tooltip(_ action: CaptureResultCard.Action, insertApp: String?, notes: Bool) -> String {
    let words = description(action, insertApp: insertApp, notes: notes)
    switch action {
    case .copy: return words + " ⌘C"
    case .apply: return words + " ⌘↩"
    case .revert, .reapply, .copyScreenshot, .open, .insert: return words
    }
  }

  /// What a footer action does, without its keys.
  func description(_ action: CaptureResultCard.Action, insertApp: String?, notes: Bool) -> String {
    switch action {
    case .revert: text(CaptureTextStringKey.revertTooltip)
    case .reapply: text(CaptureTextStringKey.reapplyTooltip)
    case .copy: notes ? text(CaptureTextStringKey.copyNotesTooltip) : island.copy
    case .copyScreenshot: text(CaptureTextStringKey.copyScreenshotTooltip)
    case .open: island.openInAtdTooltip
    case .insert: insertApp.map { island.insert(in: $0) } ?? island.insert
    case .apply: title(.apply)
    }
  }

  /// The keys the primary action shows on its button: ⌘C on Copy, ⌘↩ on a write. A secondary
  /// Copy leaves ⌘C to its tooltip, so the row keeps its actions' words where it fits them.
  static func keys(_ action: CaptureResultCard.Action, primary: CaptureResultCard.Action?)
    -> String?
  {
    guard action == primary else { return nil }
    switch action {
    case .copy: return "⌘C"
    case .apply, .insert: return "⌘↩"
    case .revert, .reapply, .copyScreenshot, .open: return nil
    }
  }

  /// The glyph an action compacts to on a narrow card; nil for the ones that keep their words
  /// (Insert and Apply: the primary writes stay labelled, as the island's do).
  func glyph(_ action: CaptureResultCard.Action) -> String? {
    switch action {
    case .revert: "undo-2"
    case .reapply: "redo-2"
    case .copy: "copy"
    case .copyScreenshot: "image"
    case .open: "arrow-up-right"
    case .insert, .apply: nil
    }
  }

  var copied: String { island.copied }

  /// The copied capsule after Copy Screenshot, with the copied image's size in points when known.
  func copiedScreenshot(size: CGSize?) -> String {
    guard let size else { return text(CaptureTextStringKey.copiedScreenshot) }
    let dimensions = "\(Int(size.width.rounded())) × \(Int(size.height.rounded()))"
    return text(CaptureTextStringKey.copiedScreenshotSize, dimensions)
  }

  /// The copied capsule after copying `count` picked paragraphs.
  func copiedText(_ count: Int) -> String { text(CaptureTextStringKey.copiedText, count) }

  var itemGone: String { text(CaptureTextStringKey.itemGone) }
  var discard: String { text(CaptureTextStringKey.discard) }
  var dockRevertTooltip: String { text(CaptureTextStringKey.dockRevertTooltip) }
  var revert: String { text(CaptureTextStringKey.revert) }
}
