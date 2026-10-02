import AppKit

/// Entry points for AppKit's nested run loops (`runModal`, `terminate` with
/// `.terminateLater`). Entered from a main-queue block — a `Task` on the main actor, a
/// dispatch source, a notification on the main queue — such a loop cannot drain the main
/// queue it runs inside, so every main-actor task stalls until it ends. Entering it from a
/// run-loop block instead keeps the main queue, and with it the main actor, running.
enum NestedRunLoop {
  /// Runs `alert` app-modally and returns its response.
  static func runModal(_ alert: NSAlert) async -> NSApplication.ModalResponse {
    await withCheckedContinuation { continuation in
      RunLoop.main.perform(inModes: [.common]) {
        MainActor.assumeIsolated { continuation.resume(returning: alert.runModal()) }
      }
    }
  }

  /// Asks the app to terminate, as the Quit menu item does.
  static func terminate() {
    RunLoop.main.perform(inModes: [.common]) {
      MainActor.assumeIsolated { NSApp.terminate(nil) }
    }
  }
}
