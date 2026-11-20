import AtdAI
import AtdActions
import AtdModel
import Foundation
import UIKit

/// What the share sheet reads and changes outside itself: the person's commands and settings in
/// the App Group, their models, Calendar, Reminders, the ledger, the web and the pasteboard.
/// `live(bundle:)` is the extension's; tests build theirs from fakes.
struct ShareServices {
  /// The command library as stored.
  var library: () -> CommandLibrary
  var settings: () -> AppSettings
  /// Remembers an option's value for a command (`CommandLibrary.setValue`), as the keyboard and
  /// the 指令 tab do.
  var remember: (_ value: String, _ key: String, _ commandID: String) -> Void
  var generator: any TextGenerating
  var calendar: CalendarWriter
  /// Reads the events a new one would clash with; it never asks for access.
  var today: TodayReader
  var reminders: ReminderWriter
  /// Nil when the App Group cannot be reached, where nothing can be logged.
  var ledger: LedgerBook?
  var pages: any PageReading
  var copy: (String) -> Void
  var now: () -> Date = { .now }

  /// Whether a model is set up to run commands with, as the keyboard decides it.
  var hasModel: Bool {
    settings().defaultConnection != nil
  }
}

extension ShareServices {
  /// The extension's own: the App Group its Info.plist names, the person's connections, EventKit,
  /// the system pasteboard, and `SharePage.js` from its bundle for shared links.
  static func live(bundle: Bundle = .main) -> ShareServices {
    let store = AppGroup.current(bundle: bundle).flatMap { SharedStore.appGroup($0) }
    let script = bundle.url(forResource: "SharePage", withExtension: "js")
      .flatMap { try? String(contentsOf: $0, encoding: .utf8) }
    return ShareServices(
      library: { store?.load(CommandLibrary.self).document ?? .initial() },
      settings: { store?.load(AppSettings.self).document ?? .initial() },
      remember: { value, key, commandID in
        // Never from a library this build cannot read: writing would set the person's aside.
        guard let store, store.load(CommandLibrary.self).source == .stored else { return }
        _ = try? store.update(CommandLibrary.self) { $0.setValue(value, for: key, in: commandID) }
      },
      generator: ModelRunner(settings: { store?.load(AppSettings.self).document ?? .initial() }),
      calendar: CalendarWriter(), today: TodayReader(), reminders: ReminderWriter(),
      ledger: store.map { LedgerBook(store: $0) }, pages: WebPageReader(script: script ?? ""),
      copy: { UIPasteboard.general.string = $0 })
  }
}
