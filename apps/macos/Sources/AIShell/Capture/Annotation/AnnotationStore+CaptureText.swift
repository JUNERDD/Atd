import AICore
import Foundation

/// Text command results on the image (``CaptureTextMarks``) as undo steps: what a run lands, piece
/// by piece as its answer streams, is one step (the run's ``CaptureTextRun/burst``), another
/// version replacing it is one more, and taking results off is one more. Both the capture
/// editor's and the long screenshot annotator's stores use them.
///
/// A commit ends any preview (``commit(_:burst:)``), so a caller lands pieces only while no
/// gesture is drawing, moving or resizing and no text is open in the editor, and lands what
/// waited once it ends. A commit of the person's own between two pieces of one run closes the
/// run's step; the pieces after it make a step of their own.
extension AnnotationStore {
  /// Draws every piece of run `id` in `runs` that should be on the image and is not yet, in front
  /// of the rest, as part of the run's undo step, taking off what another version of it put there
  /// (``CaptureTextRun/superseded``) in the same step. False when nothing was waiting.
  ///
  /// `record` takes `runs` with what each piece drew before the commit announces the new document
  /// (``onChange``), so whatever that reaches (the card, the long screenshot's summary row) reads
  /// runs that own every mark on the image; announced first, it would read a run that gave its
  /// result up to land it again (Reapply) and holds nothing yet.
  @discardableResult
  func land(
    _ id: String, of runs: CaptureTextRuns, context: CaptureTextMarks.Context,
    record: (CaptureTextRuns) -> Void
  ) -> Bool {
    guard let run = runs[id], run.needsLanding else { return false }
    let (next, produced) = CaptureTextMarks.applying(run, to: document, context: context)
    var landed = runs
    landed.update(id) { $0.landed(produced) }
    record(landed)
    commit(next, burst: run.burst)
    return true
  }

  /// Takes the annotations `ids` off the image as one undo step: a run's result (its card's
  /// Restore, ``CaptureTextRun/annotationIDs``) or every AI change (the long screenshot summary
  /// row's Restore, ``CaptureTextRuns/annotationIDs(in:)``). False when none of them is on the image.
  @discardableResult
  func takeOff(_ ids: Set<UUID>) -> Bool {
    var next = document
    for id in ids { next.remove(id) }
    guard next != document else { return false }
    commit(next)
    return true
  }
}
