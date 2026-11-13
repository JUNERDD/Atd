import Foundation

/// The card's page for the version being made (``CaptureResultCard/draft``): what it would show
/// once made, built from what its answer has so far rather than from what is on the image, since
/// nothing of it lands, previews or is copied before it is a version.
extension CaptureResultCard {
  /// The body of `draft` on `run`'s card, for the run's destination: placeholder lines until
  /// something shows, then the answer, the replacements over their originals, or the lead and
  /// the items, each step's badge hollow since none of them is on the image. Each row's id is the
  /// piece's index in the draft (``CaptureTextRun/Draft/items``), not in the run.
  static func draftBody(_ draft: CaptureTextRun.Draft, of run: CaptureTextRun) -> Body {
    switch run.destination {
    case .card:
      return draft.text.isEmpty ? .skeleton : .answer(draft.text)
    case .replace:
      let rows = draft.items.indices.compactMap { index -> Replacement? in
        let item = draft.items[index]
        guard item.tool == .replace, let id = item.paragraph, let paragraph = run[paragraph: id]
        else { return nil }
        return Replacement(id: index, original: paragraph.text, text: item.text)
      }
      return rows.isEmpty ? .skeleton : .replacements(rows)
    case .steps, .marks:
      let entries = draft.items.indices.compactMap { index -> Entry? in
        let item = draft.items[index]
        let text = item.text.trimmingCharacters(in: .whitespacesAndNewlines)
        if item.tool == .step {
          return Entry(id: index, paragraph: item.paragraph, marker: .pending, text: text)
        }
        guard !text.isEmpty, let marker = notedMarker(for: item.tool) else { return nil }
        return Entry(id: index, paragraph: item.paragraph, marker: marker, text: text)
      }
      if entries.isEmpty {
        return draft.lead.isEmpty ? .skeleton : .answer(draft.lead)
      }
      return .items(lead: draft.lead, entries)
    }
  }
}
