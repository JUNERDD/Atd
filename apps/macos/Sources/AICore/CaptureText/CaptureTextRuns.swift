import Foundation

/// The text command runs on one image (a capture session's selection, a long screenshot's kept
/// image), oldest first: one result card shows at a time (decision D8), the latest run's unless
/// an earlier run with versions was opened again (``again(_:output:reading:)``,
/// ``reopening(at:in:)``); a new run's card replaces the last one while the old run's marks stay,
/// and all of them together are what the long screenshot's summary row sums up and its Restore
/// takes off (D5).
public struct CaptureTextRuns: Equatable, Sendable {
  public private(set) var runs: [CaptureTextRun] = []

  public init() {}

  /// The newest run: the one the result card shows.
  public var latest: CaptureTextRun? { runs.last }

  /// The run in progress, if any.
  public var running: CaptureTextRun? { runs.last { $0.phase.running } }

  /// The newest run while its version under review previews on the image
  /// (``CaptureTextRun/previewed``): an answer waiting to be applied is the newest run's, since
  /// any other card showing closes it (``dropReplacedReviews(keeping:)``).
  public var reviewing: CaptureTextRun? {
    guard let latest, latest.awaitsApply else { return nil }
    return latest
  }

  public subscript(id: String) -> CaptureTextRun? { runs.first { $0.id == id } }

  /// Adds `run` as the newest.
  public mutating func start(_ run: CaptureTextRun) {
    runs.append(run)
  }

  /// Applies `update` to the run it names against `document`; false when no run here has its id.
  @discardableResult
  public mutating func apply(
    _ update: CaptureTextProgressParams, in document: AnnotationDocument, copied: Bool? = nil
  ) -> Bool {
    guard let index = runs.firstIndex(where: { $0.id == update.runId }) else { return false }
    return runs[index].apply(update, in: document, copied: copied)
  }

  /// Changes run `id` in place (recording what it applied, accepting its review).
  public mutating func update(_ id: String, _ change: (inout CaptureTextRun) -> Void) {
    guard let index = runs.firstIndex(where: { $0.id == id }) else { return }
    change(&runs[index])
  }

  /// Forgets run `id` (its results went off the image and its card closed).
  public mutating func remove(_ id: String) {
    runs.removeAll { $0.id == id }
  }

  /// Forgets every run whose answer waits for review but run `shown` (the newest when nil), whose
  /// card shows now, and says which went for the surface to close them: another card replaced
  /// theirs (decision D8), so nothing could apply or discard them any more, and none of them put
  /// anything on the image.
  public mutating func dropReplacedReviews(keeping shown: String? = nil) -> [String] {
    guard let kept = shown ?? latest?.id else { return [] }
    let dropped = runs.filter { $0.id != kept && $0.awaitsReview }.map(\.id)
    runs.removeAll { dropped.contains($0.id) }
    return dropped
  }

  /// Forgets every run.
  public mutating func removeAll() {
    runs = []
  }

  /// Every annotation a run put on the image that `document` still holds.
  public func annotationIDs(in document: AnnotationDocument) -> Set<UUID> {
    let present = Set(document.annotations.map(\.id))
    return Set(runs.flatMap(\.annotationIDs)).intersection(present)
  }

  /// What the long screenshot's summary row says about the image in `document`: the
  /// translations, step badges and highlighter marks the runs put there that are still on it, and
  /// the run in progress.
  public func summary(in document: AnnotationDocument) -> CaptureTextDockSummary {
    var summary = CaptureTextDockSummary()
    for run in runs {
      for (item, ids) in run.applied where run.items.indices.contains(item) {
        let kept = ids.filter { document[$0] != nil }
        guard !kept.isEmpty else { continue }
        switch run.items[item].tool {
        case .replace: summary.translations += 1
        case .step: summary.steps += kept.count
        case .highlight: summary.highlights += kept.count
        case .box, .ellipse, .arrow, .spotlight: summary.marks += kept.count
        case .mosaic: summary.redactions += kept.count
        }
      }
    }
    if let running {
      summary.running =
        running.destination == .replace && !running.remaking
        ? .replacing(done: running.replaced.done, total: running.replaced.total) : .reading
    }
    return summary
  }
}

/// What the long screenshot's summary row sums up: what the text commands put on the image and is
/// still there, and the run still in progress. Empty: nothing to sum up, so the row goes.
public struct CaptureTextDockSummary: Equatable, Sendable {
  /// A run still in progress, as the row shows it.
  public enum Running: Equatable, Sendable {
    /// Replacing paragraphs: so many of so many.
    case replacing(done: Int, total: Int)
    /// Any other run, until it settles.
    case reading
  }

  /// Paragraphs shown translated (replaced in place).
  public var translations = 0
  /// Numbered step badges.
  public var steps = 0
  /// Highlighter marks, one per line marked.
  public var highlights = 0
  /// Visual shape marks (boxes, ellipses, arrows, spotlights).
  public var marks = 0
  /// Mosaic redactions.
  public var redactions = 0
  public var running: Running?

  public init() {}

  public var isEmpty: Bool {
    translations == 0 && steps == 0 && highlights == 0 && marks == 0 && redactions == 0
      && running == nil
  }
}
