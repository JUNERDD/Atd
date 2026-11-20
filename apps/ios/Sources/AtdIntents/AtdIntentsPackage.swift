import AppIntents

/// This module's App Intents, which the app and the widget extension both declare: each bundle's
/// own package includes this one (`AtdAppUIPackage`, `AtdWidgetsUIPackage`).
///
/// The build decides which bundle declares an intent: it merges into an extension's
/// `Metadata.appintents` the intents of every package module the extension links, and into the
/// app's those of every package module in the app's build, its embedded extensions' modules
/// included. So every intent is the app's too, and must live in a module the app links, or the
/// app would declare an intent it cannot run: AtdWidgetsUI and AtdShareUI define none. An intent
/// here is declared by the app and the widget extension, and the system picks the process by
/// kind: a control or Shortcuts action that opens the app, and a `LiveActivityIntent`, run in the
/// app; a widget button's plain intent runs in the widget extension. Intents only the app runs
/// (Siri, Shortcuts, Spotlight) belong in `AtdAppUI/Intents/`; a widget's configuration intent in
/// the feature module that owns its data (`AtdMiniApps`).
///
/// Copy: App Intents read strings only from the main bundle, and the metadata processor reads
/// titles at build time. So every title, parameter name and dialog is a literal
/// `LocalizedStringResource("key", table: "<Feature>Intents")`, and the tables live in
/// `MainBundle/` (SwiftPM excludes it; project.yml compiles it into the app and the widget
/// extension). Copy that is not App Intents copy goes in `Resources/<Feature>.xcstrings`.
public struct AtdIntentsPackage: AppIntentsPackage {}
