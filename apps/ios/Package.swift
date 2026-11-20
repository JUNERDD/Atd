// swift-tools-version: 6.2
import PackageDescription

/// The two interface targets default to the main actor: almost everything in them drives UIKit or
/// SwiftUI, so off-main work is the explicit exception (`nonisolated`, `@concurrent`).
let mainActorByDefault: [SwiftSetting] = [
  .defaultIsolation(MainActor.self),
  .enableUpcomingFeature("NonisolatedNonsendingByDefault"),
  .enableUpcomingFeature("InferIsolatedConformances"),
]

/// The model, AI, pinyin and keyboard-session targets stay nonisolated: plain values, Sendable
/// services and a main-actor session type, none of them importing UIKit or SwiftUI.
let nonisolatedByDefault: [SwiftSetting] = [
  .enableUpcomingFeature("NonisolatedNonsendingByDefault"),
  .enableUpcomingFeature("InferIsolatedConformances"),
]

/// All of Atd for iPhone lives in this package; the XcodeGen targets in `project.yml` only link
/// `AtdAppUI` (the app) or `AtdKeyboardUI` (the keyboard extension) and supply the bundles,
/// Info.plists and entitlements. No third-party dependencies: the keyboard extension runs under a
/// tight memory limit and links only what typing needs.
let package = Package(
  name: "AtdMobile",
  defaultLocalization: "en",
  platforms: [.iOS(.v26)],
  products: [
    .library(name: "AtdAppUI", targets: ["AtdAppUI"]),
    .library(name: "AtdKeyboardUI", targets: ["AtdKeyboardUI"]),
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
    // The SwiftUI app: the 指令 and 我的 tabs, 问 Atd and the ink-and-paper style.
    .target(
      name: "AtdAppUI", dependencies: ["AtdModel", "AtdAI"], resources: [.process("Resources")],
      swiftSettings: mainActorByDefault),
    // The UIKit keyboard extension's controller, keys, strip and panels.
    .target(
      name: "AtdKeyboardUI", dependencies: ["AtdModel", "AtdAI", "AtdPinyin", "AtdKeyboardCore"],
      swiftSettings: mainActorByDefault),
    .testTarget(name: "AtdModelTests", dependencies: ["AtdModel"]),
    .testTarget(name: "AtdAITests", dependencies: ["AtdAI"]),
    .testTarget(name: "AtdPinyinTests", dependencies: ["AtdPinyin"]),
    .testTarget(
      name: "AtdKeyboardCoreTests",
      dependencies: ["AtdKeyboardCore", "AtdModel", "AtdAI", "AtdPinyin"]),
  ],
  swiftLanguageModes: [.v6]
)
