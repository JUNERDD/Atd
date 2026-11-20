// swift-tools-version: 6.2
import PackageDescription

/// The interface targets default to the main actor: almost everything in them drives UIKit or
/// SwiftUI, so off-main work is the explicit exception (`nonisolated`, `@concurrent`). Their App
/// Intents (`AppIntent` is `Sendable` with a nonisolated `perform()`) are declared `nonisolated`.
let mainActorByDefault: [SwiftSetting] = [
  .defaultIsolation(MainActor.self),
  .enableUpcomingFeature("NonisolatedNonsendingByDefault"),
  .enableUpcomingFeature("InferIsolatedConformances"),
]

/// The model, AI, pinyin, keyboard-session, intents, mini-app, automation and widget targets stay
/// nonisolated: plain values, Sendable services, App Intents and WidgetKit providers, which the
/// system calls off the main actor. Views still run on the main actor through `View`.
let nonisolatedByDefault: [SwiftSetting] = [
  .enableUpcomingFeature("NonisolatedNonsendingByDefault"),
  .enableUpcomingFeature("InferIsolatedConformances"),
]

/// All of Atd for iPhone lives in this package; the XcodeGen targets in `project.yml` only link
/// products (`AtdAppUI` and `AtdIntents`, whose intents the app's App Shortcuts name, for the app;
/// `AtdKeyboardUI`, `AtdShareUI`, `AtdWidgetsUI` and `AtdCameraUI` for the extensions) and supply
/// the bundles, Info.plists and entitlements. No third-party dependencies: the keyboard extension
/// runs under a tight memory limit and links only what typing needs, so AtdModel, AtdAI, AtdPinyin
/// and the keyboard targets never import EventKit, WidgetKit, ActivityKit, AVFoundation, WebKit or
/// AppIntents.
///
/// App Intents: an extension declares every intent of every module it links, and the app every
/// intent of every module in its build, its extensions' included (`AtdIntentsPackage` has the
/// rule), so intents live only in modules the app links. App Intents read their copy only from
/// the main bundle: a module's `MainBundle/` tables are excluded here and compiled into every
/// bundle that declares its intents (project.yml).
let package = Package(
  name: "AtdMobile",
  defaultLocalization: "en",
  platforms: [.iOS(.v26)],
  products: [
    .library(name: "AtdAppUI", targets: ["AtdAppUI"]),
    .library(name: "AtdIntents", targets: ["AtdIntents"]),
    .library(name: "AtdAutomations", targets: ["AtdAutomations"]),
    .library(name: "AtdKeyboardUI", targets: ["AtdKeyboardUI"]),
    .library(name: "AtdShareUI", targets: ["AtdShareUI"]),
    .library(name: "AtdWidgetsUI", targets: ["AtdWidgetsUI"]),
    .library(name: "AtdCameraUI", targets: ["AtdCameraUI"]),
  ],
  targets: [
    // Commands, phrases and settings, and the App Group files the app and the keyboard share.
    .target(
      name: "AtdModel", resources: [.process("Resources")], swiftSettings: nonisolatedByDefault),
    // The person's own providers, called directly: the two wire protocols, their keys in the
    // shared Keychain group, and the prompts every command and question is sent with.
    .target(
      name: "AtdAI", dependencies: ["AtdModel"], resources: [.process("Resources")],
      swiftSettings: nonisolatedByDefault),
    // Pinyin to Chinese: the rime-pinyin-simp lexicon, mapped read-only, and the engine behind
    // the PinyinConverting protocol.
    .target(
      name: "AtdPinyin", resources: [.copy("Resources/pinyin.lexicon")],
      swiftSettings: nonisolatedByDefault),
    // What the keyboard's keys and strip do to the host field: composition, previews of results,
    // the ✦ line and the clipboard, behind protocols for the field and the pasteboard so it runs
    // and is tested without UIKit.
    .target(
      name: "AtdKeyboardCore", dependencies: ["AtdModel", "AtdAI", "AtdPinyin"],
      swiftSettings: nonisolatedByDefault),
    // What card results do in the person's name: Calendar and Reminders through EventKit, behind
    // protocols so the logic runs without permissions, and the expense ledger. Never linked by
    // the keyboard.
    .target(name: "AtdActions", dependencies: ["AtdModel"], swiftSettings: nonisolatedByDefault),
    // The ink-and-paper look the app, its widgets, mini apps and the camera share: colors, shapes
    // drawn by hand, stickers, doodles and the inked controls. SwiftUI only, so every extension
    // that draws ink can link it.
    .target(
      name: "AtdInk", dependencies: ["AtdModel"], resources: [.process("Resources")],
      swiftSettings: mainActorByDefault),
    // The intents the app and the widget extension both declare (controls, widget buttons, Live
    // Activity intents) and what they share with Siri and Shortcuts, plus the briefing's Live
    // Activity attributes.
    .target(
      name: "AtdIntents", dependencies: ["AtdModel", "AtdAI", "AtdActions"],
      exclude: ["MainBundle"], resources: [.process("Resources")],
      swiftSettings: nonisolatedByDefault),
    // 拍了就办: the viewfinder the app and the Lock Screen capture extension show, and the
    // CameraCaptureIntent the app, the capture and the widget extensions all declare.
    .target(
      name: "AtdCameraUI", dependencies: ["AtdModel", "AtdInk"], exclude: ["MainBundle"],
      resources: [.process("Resources")], swiftSettings: mainActorByDefault),
    // AI-built mini apps, the data their native widgets draw and the widgets' configuration
    // intent.
    .target(
      name: "AtdMiniApps", dependencies: ["AtdModel", "AtdAI", "AtdActions", "AtdInk"],
      exclude: ["MainBundle"], resources: [.process("Resources")],
      swiftSettings: nonisolatedByDefault),
    // Context automations that Shortcuts personal automations run, and their Live Activities.
    .target(
      name: "AtdAutomations", dependencies: ["AtdModel", "AtdAI", "AtdActions"],
      exclude: ["MainBundle"], resources: [.process("Resources")],
      swiftSettings: nonisolatedByDefault),
    // The share extension's screens.
    .target(
      name: "AtdShareUI", dependencies: ["AtdModel", "AtdAI", "AtdActions"],
      resources: [.process("Resources")], swiftSettings: mainActorByDefault),
    // The widget extension's widgets, controls and Live Activity views. No App Intents: the
    // app declares them too, so they live in modules it links.
    .target(
      name: "AtdWidgetsUI",
      dependencies: [
        "AtdModel", "AtdActions", "AtdInk", "AtdIntents", "AtdMiniApps", "AtdAutomations",
        "AtdCameraUI",
      ],
      resources: [.process("Resources")], swiftSettings: nonisolatedByDefault),
    // The SwiftUI app: the four tabs, 问 Atd, the camera and the ink pages, and the intents only
    // the app declares (Intents/).
    .target(
      name: "AtdAppUI",
      dependencies: [
        "AtdModel", "AtdAI", "AtdActions", "AtdInk", "AtdIntents", "AtdCameraUI", "AtdMiniApps",
        "AtdAutomations",
      ],
      resources: [.process("Resources")], swiftSettings: mainActorByDefault),
    // The UIKit keyboard extension's controller, keys, strip and panels.
    .target(
      name: "AtdKeyboardUI", dependencies: ["AtdModel", "AtdAI", "AtdPinyin", "AtdKeyboardCore"],
      resources: [.process("Resources")], swiftSettings: mainActorByDefault),
    .testTarget(name: "AtdModelTests", dependencies: ["AtdModel"]),
    .testTarget(name: "AtdAITests", dependencies: ["AtdAI"]),
    .testTarget(name: "AtdKeyboardUITests", dependencies: ["AtdKeyboardUI"]),
    .testTarget(name: "AtdPinyinTests", dependencies: ["AtdPinyin"]),
    .testTarget(
      name: "AtdKeyboardCoreTests",
      dependencies: ["AtdKeyboardCore", "AtdModel", "AtdAI", "AtdPinyin"]),
    .testTarget(name: "AtdActionsTests", dependencies: ["AtdActions", "AtdModel"]),
    .testTarget(
      name: "AtdCameraTests", dependencies: ["AtdCameraUI", "AtdAppUI", "AtdAI", "AtdModel"]),
    .testTarget(
      name: "AtdIntentsTests",
      dependencies: ["AtdIntents", "AtdModel", "AtdAI", "AtdActions", "AtdWidgetsUI"]),
    .testTarget(
      name: "AtdAutomationsTests",
      dependencies: ["AtdAutomations", "AtdModel", "AtdAI", "AtdActions", "AtdWidgetsUI"]),
  ],
  swiftLanguageModes: [.v6]
)
