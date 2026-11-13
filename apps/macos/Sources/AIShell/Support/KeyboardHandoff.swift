import AppKit

/// One pending keyboard transfer per surface. Replacing or dismissing the surface cancels it;
/// moving to another app while waiting leaves the keyboard with the user's new destination.
final class KeyboardHandoff {
  private var waiting: Task<Void, Never>?

  func perform(_ transfer: @escaping @MainActor () -> Void) {
    cancel()
    let source = NSWorkspace.shared.frontmostApplication?.processIdentifier
    let sourceWindow = NSApp.keyWindow
    waiting = Task { [weak self] in
      let released = await ShortcutRelease.waitForHandoff(isValid: {
        NSWorkspace.shared.frontmostApplication?.processIdentifier == source
          && NSApp.keyWindow === sourceWindow
      })
      guard released, let self else { return }
      waiting = nil
      transfer()
    }
  }

  func cancel() {
    waiting?.cancel()
    waiting = nil
  }

  isolated deinit { waiting?.cancel() }
}
