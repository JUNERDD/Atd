import AICore
import AppKit
import SwiftUI

/// What measuring the compose card's width and note costs a hosting view each: kept for the
/// command, attach flag, note and language it was measured for, so typing, which changes none of
/// them, re-measures only the field's lines.
struct ComposeMeasureCache {
  struct Key: Equatable {
    let command: String
    let attach: Bool
    let note: ComposeDraft.Note?
    let labels: IslandLabels
  }

  var key: Key?
  var width = 0.0
  var note = 0.0
}

extension IslandController {
  /// The compose card's rest size: as wide as its title and footer within
  /// ``IslandMetrics/composeCardWidth(ideal:)``, and as tall as its note wraps to at that width,
  /// its field's lines (``composeFieldLines(width:)``) and its chips' row make it
  /// (``IslandMetrics/composeCardHeight(note:field:chips:)``).
  func measureCompose(command: String, attach: Bool) -> IslandMeasure {
    let draft = model.compose
    let key = ComposeMeasureCache.Key(
      command: command, attach: attach, note: draft.note, labels: model.labels)
    if composeMeasures.key != key {
      let probe = IslandComposeCard(model: model, command: command, attach: attach, active: false)
      let ideal = NSHostingView(rootView: probe.widthProbe.fixedSize()).fittingSize.width
      let width = IslandMetrics.composeCardWidth(ideal: ideal)
      let note = IslandComposeNote(model: model, note: draft.note, attach: attach)
      composeMeasures = ComposeMeasureCache(
        key: key, width: width,
        note: Self.height(of: note, width: width - IslandMetrics.cardPadding * 2))
    }
    let width = composeMeasures.width
    let inner = width - IslandMetrics.cardPadding * 2
    let field = IslandMetrics.composeFieldHeight(
      lines: composeFieldLines(width: inner - IslandMetrics.rowPadding * 2),
      lineHeight: Self.composeLineHeight)
    let height = IslandMetrics.composeCardHeight(
      note: composeMeasures.note, field: field, chips: !draft.files.isEmpty)
    return IslandMeasure(size: WindowSize(width: width, height: height))
  }

  /// The field's text type (``IslandType/answer``) and its line height, as AppKit lays it out.
  private static let composeFont = NSFont.systemFont(ofSize: 13)
  private static let composeLineHeight = NSLayoutManager().defaultLineHeight(for: composeFont)

  /// How many lines the field's text takes in a field whose text is `width` points wide. While
  /// the field is being edited, its own layout answers, exactly as it wraps (a trailing newline's
  /// empty line included); otherwise the text is measured as it would wrap there.
  private func composeFieldLines(width: Double) -> Int {
    let text = model.compose.text
    if let field = editingField, field.string == text, let layout = field.layoutManager,
      let container = field.textContainer
    {
      layout.ensureLayout(for: container)
      let line = layout.defaultLineHeight(for: field.font ?? Self.composeFont)
      return Int((layout.usedRect(for: container).height / line).rounded())
    }
    guard !text.isEmpty else { return 1 }
    // The text view's line fragment padding takes a little of the width either side, and a
    // trailing newline starts a line that measuring would otherwise leave out.
    let sample = text.hasSuffix("\n") ? text + " " : text
    let rect = (sample as NSString).boundingRect(
      with: CGSize(width: max(width - 4, 1), height: .greatestFiniteMagnitude),
      options: [.usesLineFragmentOrigin, .usesFontLeading], attributes: [.font: Self.composeFont])
    return Int((rect.height / Self.composeLineHeight).rounded())
  }
}
