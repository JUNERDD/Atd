import AtdModel
import Foundation
import Observation
import UIKit

/// One share, from reading what was shared to finishing: the commands that fit it and the run the
/// person opened from them.
@Observable final class ShareSession {
  enum Phase: Equatable {
    case reading
    /// Nothing that was shared is something Atd can read.
    case unreadable
    /// No model is set up in Atd yet.
    case noModel
    case ready(SharedContent, ShareMenu)
  }

  private(set) var phase = Phase.reading
  /// The run on show over the list; nil on the list. Leaving a run stops it.
  var run: ShareRun? {
    didSet { if oldValue !== run { oldValue?.stop() } }
  }

  let services: ShareServices
  private let complete: () -> Void
  private let dismiss: () -> Void

  /// - Parameters:
  ///   - complete: ends the share as done (完成).
  ///   - dismiss: ends it as cancelled (the list's ✕).
  init(
    services: ShareServices, complete: @escaping () -> Void, dismiss: @escaping () -> Void
  ) {
    self.services = services
    self.complete = complete
    self.dismiss = dismiss
  }

  /// Reads the extension's input items and lists what fits them.
  func read(_ items: [NSExtensionItem]) async {
    phase = .reading
    show(await SharedItemReader().content(of: items))
  }

  func show(_ content: SharedContent?) {
    guard let content else {
      phase = .unreadable
      return
    }
    guard services.hasModel else {
      phase = .noModel
      return
    }
    let menu = ShareMenu(
      commands: services.library().commands, content: content, now: services.now())
    phase = .ready(content, menu)
  }

  /// Opens `entry`'s command over the list and starts it.
  func open(_ entry: ShareMenu.Entry) {
    guard case .ready(let content, _) = phase else { return }
    let run = ShareRun(command: entry.command, content: content, services: services) {
      [weak self] read in
      // A shared link's page is read once; the next command reuses it.
      guard let self, case .ready(_, let menu) = phase else { return }
      phase = .ready(read, menu)
    }
    self.run = run
    run.start()
  }

  func finish() {
    run?.stop()
    complete()
  }

  func cancel() {
    run?.stop()
    dismiss()
  }
}
