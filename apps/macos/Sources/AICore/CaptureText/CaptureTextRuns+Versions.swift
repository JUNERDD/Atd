import CoreGraphics
import Foundation

/// The runs of one image whose answers have versions (any output, gated or not), as the image and
/// the person work with them: the image is the source of truth for the version a run shows, so
/// after undo or redo each run follows the version the image holds (``follow(_:)``); running a
/// run's command again on the same text makes another version of it (``again(_:output:reading:)``);
/// and a click on a run's result opens its card again (``reopening(at:in:)``, ``mark(at:in:)``).
extension CaptureTextRuns {
  /// Undo or redo changed the image to `document`: each run follows the version of its answer the
  /// image now holds (``CaptureTextRun/follow(_:)``). Returns the runs whose card must show
  /// another version now (`captureText.action`'s `version`), with that version.
  public mutating func follow(_ document: AnnotationDocument) -> [(run: String, version: Int)] {
    let present = Set(document.annotations.map(\.id))
    var shown: [(run: String, version: Int)] = []
    for run in runs where run.review != nil {
      var version: Int?
      update(run.id) { version = $0.follow(present) }
      if let version { shown.append((run.id, version)) }
    }
    return shown
  }

  /// The run a launch of command `commandId`, whose answer goes to `output`, reading `reading`,
  /// makes another version of instead of starting a run: the newest run of that command and
  /// output whose first version came (``CaptureTextRun/versioned``) and reads the same
  /// paragraphs, in any order; nil when none does.
  public func again(
    _ commandId: String, output: CommandOutputAction, reading: [CaptureTextParagraph]
  ) -> CaptureTextRun? {
    guard commandId != CaptureTextRun.askID else { return nil }
    let wanted = Self.keys(reading)
    return runs.last { run in
      run.commandId == commandId && run.output == output && run.versioned
        && run.paragraphs.count == reading.count
        && Self.keys(run.paragraphs.map(\.paragraph)) == wanted
    }
  }

  /// Whether a click on a run's result may open its card again: no run is producing (a new
  /// version included) and no version waits for the person to apply it.
  public var reopens: Bool { running == nil && !runs.contains(where: \.awaitsApply) }

  /// The newest run with versions whose result in `document` is under `point`: a paragraph one of
  /// its pieces on the image is about, or one of the annotations it drew (a replacement's plate, a
  /// step badge, a highlighter mark); nil when none is, or while nothing may open
  /// (``reopens``).
  public func reopening(at point: CGPoint, in document: AnnotationDocument) -> CaptureTextRun? {
    guard reopens else { return nil }
    let present = Set(document.annotations.map(\.id))
    let hit = document.hit(at: point, tolerance: 2)
    return runs.last { run in
      guard run.review != nil else { return false }
      return run.applied.contains { item, ids in
        guard run.items.indices.contains(item), ids.contains(where: present.contains) else {
          return false
        }
        if let hit, ids.contains(hit) { return true }
        return run[paragraph: run.items[item].paragraph]?.box.contains(point) == true
      }
    }
  }

  /// The run with versions whose step badge or highlighter mark is the front-most annotation under
  /// `point` in `document`, which a click opens (so the pointer shows it acts); nil when none is,
  /// or while nothing may open (``reopens``).
  public func mark(at point: CGPoint, in document: AnnotationDocument) -> String? {
    guard reopens, let hit = document.hit(at: point, tolerance: 2), let shape = document[hit]?.shape
    else { return nil }
    switch shape {
    case .step, .highlighter: break
    default: return nil
    }
    return runs.last { $0.review != nil && $0.annotationIDs.contains(hit) }?.id
  }

  /// Paragraphs as a set to compare by (``CaptureTextParagraph/readingKey``).
  private static func keys(_ paragraphs: [CaptureTextParagraph]) -> Set<String> {
    Set(paragraphs.map(\.readingKey))
  }
}
