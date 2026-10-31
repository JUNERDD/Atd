import AICore
import AppKit
import OSLog

/// A drop's promised files (Photos, a browser's images, Mail's attachments), taken the mini
/// panel's way on the mini panel and the task panel alike. They are received into a drop folder
/// of their own (``MiniPanelDropFolder``) and handed on a batch at a time as they arrive
/// (``MiniPanelPromises``). Once the wait is over (``MiniPanelPromiseOutcome``), the drop's own
/// image stands in when no file arrived, while the drag pasteboard still holds it; otherwise
/// whatever failed or never came is reported by name, like an import's failures.
struct PromisedDrop {
  /// The name a dropped file that never arrived is reported under, which is data the page shows,
  /// like `Dropped text <date>.txt`.
  static let unnamed = "Dropped file"

  let folder: MiniPanelDropFolder
  let log: Logger
  /// Received files, a batch at a time.
  let deliver: ([URL]) -> Void
  /// The drop's image, when no promised file arrived.
  let importImage: (Data) -> Void
  let reportFailures: ([ResourcesImportedEvent.Failure]) -> Void
  /// The wait is over, and what came of it was handed on.
  var finished: () -> Void = {}

  func receive(_ receivers: [NSFilePromiseReceiver], from board: NSPasteboard) {
    folder.pruneInBackground()
    // The drop's own image, still on the pasteboard while no other drag replaced it, stands in
    // for promises that bring nothing; it is read only then.
    let changeCount = board.changeCount
    let image = MiniPanelDragOffer(types: board.types ?? []).image
    let destination: URL
    do {
      destination = try folder.makeDropFolder()
    } catch {
      log.error("A drop folder could not be made: \(String(describing: error))")
      reportFailures([.init(name: Self.unnamed, reason: .unreadable)])
      return finished()
    }
    MiniPanelPromises.receive(
      receivers, into: destination, deliver: deliver,
      settled: { result in
        settle(result, image: image && board.changeCount == changeCount ? board : nil)
      })
  }

  /// What the wait came to: the drop's image when nothing arrived and it is still there,
  /// otherwise the promised files that failed or never came.
  private func settle(_ result: MiniPanelPromises.Settled, image board: NSPasteboard?) {
    defer { finished() }
    let reasons = result.reasons.isEmpty ? "none" : result.reasons.joined(separator: ", ")
    log.info(
      """
      Promised files: received \(result.received, privacy: .public) of \
      \(result.expected, privacy: .public); failures: \(reasons, privacy: .public)
      """)
    let image = result.received == 0 ? board.flatMap(MiniPanelDropPayload.image(on:)) : nil
    let settlement = MiniPanelPromiseOutcome.settle(
      expected: result.expected, received: result.received, failed: result.failed,
      imageAvailable: image != nil)
    if settlement.useImage, let image {
      log.info("Promised files: none arrived; the drop's image goes in instead.")
      return importImage(image)
    }
    guard settlement.failures > 0 else { return }
    let failures = settlement.failures
    log.info("Promised files: \(failures, privacy: .public) reported.")
    let unnamed = Array(
      repeating: Self.unnamed, count: max(failures - result.missingNames.count, 0))
    let names = (result.missingNames + unnamed).prefix(failures)
    reportFailures(names.map { .init(name: String($0.prefix(255)), reason: .unreadable) })
  }
}
