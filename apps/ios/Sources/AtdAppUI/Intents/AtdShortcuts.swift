/// Keeps Atd's App Shortcuts current. Call `refresh()` after anything an App Shortcut offers
/// changes, such as the command library.
///
/// The `AppShortcutsProvider` must be declared in the App target, which this module cannot name,
/// so the app installs its update at launch (`AtdAppLaunch.prepare(shortcuts:)`). Until then, as
/// in tests and previews, `refresh()` does nothing.
public enum AtdShortcuts {
  private static var update: (@MainActor () -> Void)?

  static func install(_ update: @escaping @MainActor () -> Void) {
    self.update = update
  }

  public static func refresh() {
    update?()
  }
}
