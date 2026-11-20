import AppIntents
import AtdIntents

/// Atd's App Shortcuts: what Siri and Spotlight offer without any setup, each phrase with Atd's
/// name in it. The build reads App Shortcuts only from the App target's own sources, so this
/// provider lives here while its intents live in the package; phrases are translated in
/// `AppShortcuts.xcstrings`, short titles in the intents' own tables.
///
/// Stub (F0a): one shortcut. WS-A owns this file and the phrases.
struct AtdAppShortcuts: AppShortcutsProvider {
  static var appShortcuts: [AppShortcut] {
    AppShortcut(
      intent: OpenAskIntent(),
      phrases: ["Ask \(.applicationName)", "Quick question for \(.applicationName)"],
      shortTitle: LocalizedStringResource("openAsk.title", table: "EntryIntents"),
      systemImageName: "waveform")
  }
}
