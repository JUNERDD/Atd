import AtdIntents
import Foundation
import WidgetKit

/// What Atd's entry points need each time the app starts, whether the person opened it or the
/// system launched it in the background to run an intent.
public enum EntryRuntime {
  /// Call once while the app launches, from `AtdAppLaunch.prepare(shortcuts:)`.
  public static func start() {
    let launch = Date.now
    // Siri's and Spotlight's commands follow the library, which the keyboard or a newer build
    // may have changed while Atd was not running.
    AtdShortcuts.refresh()
    // Access to the calendar may have changed in Settings.
    WidgetCenter.shared.reloadTimelines(ofKind: EntryWidgetKind.nextItem)
    Task { await CommandActivity.endOrphans(startedBefore: launch) }
    #if DEBUG
      EntryDebug.start(arguments: ProcessInfo.processInfo.arguments)
    #endif
  }
}
