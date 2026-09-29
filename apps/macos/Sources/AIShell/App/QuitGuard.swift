import AICore
import AppKit

/// The app's quit flow (apps/desktop/electron/quit-guard.ts). Stopping the service cancels its
/// started runs, so a quit someone asked for first asks whether to stop running tasks; queued
/// runs stay queued and start with the next service. Once a quit is committed the windows go
/// away, the service stops, and the app terminates; any later quit passes straight through, so
/// quitting again ends a hung teardown.
///
/// Unattended quits never ask: logout, restart or shutdown (the quit Apple event's reason, or
/// `willPowerOff`) and termination signals. A prompt already open when one arrives is aborted
/// and the teardown starts without its answer.
@MainActor
final class QuitGuard {
  /// The service's started and queued runs; an unreachable or slow service counts as idle.
  private let activeRuns: @MainActor () async -> Int
  /// Runs once a quit is committed, before the app terminates.
  private let stopService: @MainActor () async -> Void
  private let hideWindows: () -> Void
  private var unattended = false
  private var tearingDown = false
  private var asking = false
  private var signalSources: [any DispatchSourceSignal] = []

  init(
    activeRuns: @escaping @MainActor () async -> Int,
    stopService: @escaping @MainActor () async -> Void, hideWindows: @escaping () -> Void
  ) {
    self.activeRuns = activeRuns
    self.stopService = stopService
    self.hideWindows = hideWindows
    NSWorkspace.shared.notificationCenter.addObserver(
      forName: NSWorkspace.willPowerOffNotification, object: nil, queue: .main
    ) { [weak self] _ in
      MainActor.assumeIsolated { self?.becomeUnattended() }
    }
    for signal in [SIGTERM, SIGINT, SIGHUP] {
      Foundation.signal(signal, SIG_IGN)
      let source = DispatchSource.makeSignalSource(signal: signal, queue: .main)
      source.setEventHandler { [weak self] in
        MainActor.assumeIsolated {
          self?.becomeUnattended()
          NestedRunLoop.terminate()
        }
      }
      source.resume()
      signalSources.append(source)
    }
  }

  /// `applicationShouldTerminate`: asks, tears down, or lets a repeated quit through.
  func shouldTerminate() -> NSApplication.TerminateReply {
    if tearingDown { return .terminateNow }
    if Self.quitIsUnattended() { unattended = true }
    if asking { return .terminateCancel }
    asking = true
    Task { @MainActor in
      var confirmed = unattended
      if !confirmed {
        let count = await activeRuns()
        confirmed = await confirm(count: count) || unattended
      }
      asking = false
      guard confirmed || unattended else {
        NSApp.reply(toApplicationShouldTerminate: false)
        return
      }
      tearingDown = true
      hideWindows()
      await stopService()
      NSApp.reply(toApplicationShouldTerminate: true)
    }
    return .terminateLater
  }

  private func becomeUnattended() {
    unattended = true
    // An open prompt answers Cancel; `shouldTerminate`'s task then tears down anyway.
    if asking, NSApp.modalWindow != nil { NSApp.abortModal() }
  }

  /// True when the user chose to quit.
  private func confirm(count: Int) async -> Bool {
    guard count > 0, !unattended else { return true }
    let strings = ShellStrings.shared
    let alert = NSAlert()
    alert.alertStyle = .warning
    alert.messageText = strings.text(.quitTitle)
    alert.informativeText =
      (count == 1 ? strings.text(.quitMessageOne) : strings.text(.quitMessageOther, count: count))
      + "\n\n" + strings.text(.quitDetail)
    let quit = alert.addButton(withTitle: strings.text(.quitConfirm))
    let cancel = alert.addButton(withTitle: strings.text(.cancel))
    quit.hasDestructiveAction = true
    // Cancel is the default and the Escape answer, as in Electron (`defaultId`/`cancelId` 1).
    quit.keyEquivalent = ""
    cancel.keyEquivalent = "\r"
    // A menu bar app is often not frontmost when it is quit.
    NSApp.activate()
    return await NestedRunLoop.runModal(alert) == .alertFirstButtonReturn
  }

  /// The quit Apple event of a logout, restart or shutdown carries its reason.
  private static func quitIsUnattended() -> Bool {
    guard let event = NSAppleEventManager.shared().currentAppleEvent,
      event.eventClass == kCoreEventClass, event.eventID == kAEQuitApplication,
      let reason = event.attributeDescriptor(forKeyword: kAEQuitReason)?.enumCodeValue
    else { return false }
    return [
      kAELogOut, kAEReallyLogOut, kAEShowRestartDialog, kAEShowShutdownDialog, kAERestart,
      kAEShutDown,
    ].contains(reason)
  }
}
