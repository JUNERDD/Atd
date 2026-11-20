import AppIntents
import AtdAppUI
import AtdIntents

/// Atd's App Shortcuts: what Siri and Spotlight offer without any setup, each phrase with Atd's
/// name in it. The build reads App Shortcuts only from the App target's own sources, so this
/// provider lives here while its intents live in the package; phrases are translated in
/// `AppShortcuts.xcstrings`, short titles in the intents' own tables. `AtdShortcuts.refresh()`
/// updates the commands 运行指令's phrase can name.
struct AtdAppShortcuts: AppShortcutsProvider {
  static var appShortcuts: [AppShortcut] {
    AppShortcut(
      intent: SummarizeClipboardIntent(),
      phrases: [
        "Summarize my clipboard with \(.applicationName)",
        "\(.applicationName) summarize clipboard",
      ],
      shortTitle: LocalizedStringResource("summarize.title", table: "EntryIntents"),
      systemImageName: "doc.on.clipboard")
    AppShortcut(
      intent: ReadBriefingIntent(),
      phrases: ["\(.applicationName) briefing", "Today's briefing in \(.applicationName)"],
      shortTitle: LocalizedStringResource("briefing.title", table: "EntryIntents"),
      systemImageName: "sunrise")
    AppShortcut(
      intent: OpenAskIntent(),
      phrases: ["Ask \(.applicationName)", "Quick question for \(.applicationName)"],
      shortTitle: LocalizedStringResource("openAsk.title", table: "EntryIntents"),
      systemImageName: "waveform")
    AppShortcut(
      intent: RunCommandIntent(),
      phrases: [
        "Run a command with \(.applicationName)", "Run \(\.$command) with \(.applicationName)",
      ],
      shortTitle: LocalizedStringResource("runCommand.title", table: "EntryIntents"),
      systemImageName: "wand.and.sparkles")
  }

  static let shortcutTileColor: ShortcutTileColor = .grayBlue
}
