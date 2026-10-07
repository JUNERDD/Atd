// swift-tools-version: 6.2
import PackageDescription

/// The app-facing targets default to the main actor: almost everything in them drives AppKit,
/// WebKit or main-queue URLSession callbacks, so off-main work is the explicit exception
/// (`nonisolated`, `@concurrent`). AICore stays nonisolated: it is pure policy plus the generated
/// bridge types, used from any context.
let approachableConcurrency: [SwiftSetting] = [
  .defaultIsolation(MainActor.self),
  .enableUpcomingFeature("NonisolatedNonsendingByDefault"),
  .enableUpcomingFeature("InferIsolatedConformances"),
]

/// All shell logic lives in this package; the XcodeGen App target (`project.yml`) only links
/// `AIShell` and supplies the bundle, Info.plist and signing.
let package = Package(
  name: "AIMac",
  platforms: [.macOS(.v26)],
  products: [
    .library(name: "AICore", targets: ["AICore"]),
    .library(name: "AIShell", targets: ["AIShell"]),
    // Shared with the WidgetKit extension (`AtdWidgets` in project.yml).
    .library(name: "AIWidgetModel", targets: ["AIWidgetModel"]),
    .library(name: "AIWidgetRender", targets: ["AIWidgetRender"]),
  ],
  // Package.resolved is not checked in, so the one dependency is pinned exactly.
  dependencies: [
    .package(url: "https://github.com/sparkle-project/Sparkle", exact: "2.10.0")
  ],
  targets: [
    // Pure, Foundation-only policy: relay normalization and allow-listing, stream frame rules,
    // accelerator conversion and supervisor timing. No AppKit or WebKit, so all of it is
    // unit-testable.
    .target(name: "AICore"),
    // The app: windows, menus, hot keys and native capabilities, composed with the relay and
    // the service (Debug connects to `pnpm dev`, Release supervises the bundled service), and
    // Release builds' Sparkle updater.
    .target(
      name: "AIShell",
      dependencies: [
        "AICore", "AIRelay", "AIWidgetModel", "AIWidgetRender",
        .product(name: "Sparkle", package: "Sparkle"),
      ],
      swiftSettings: approachableConcurrency),
    // The renderer relay, virtual socket pipe, control stream and service access: Foundation,
    // WebKit and AICore, no AppKit windows. AIShell wires it to its web views.
    .target(
      name: "AIRelay", dependencies: ["AICore", "AIWidgetModel"],
      swiftSettings: approachableConcurrency),
    // Desktop widgets' data, shared by the shell (the only writer) and the sandboxed WidgetKit
    // extension (a reader): the generated view tree and sync types, the files' layout and the
    // widget link. Foundation and AICore only.
    .target(name: "AIWidgetModel", dependencies: ["AICore"]),
    // The SwiftUI renderer of a widget's view tree, used by the extension and by the shell's
    // previews, so both draw a snapshot the same way.
    .target(name: "AIWidgetRender", dependencies: ["AIWidgetModel"]),
    .testTarget(name: "AICoreTests", dependencies: ["AICore"]),
    // Runs a real WKWebView against a local stub service; see RelayIntegrationTests.
    .testTarget(name: "AIRelayTests", dependencies: ["AIRelay", "AICore"]),
    // Real WKWebView checks of the private WebKit settings the shell depends on.
    .testTarget(name: "AIShellTests", dependencies: ["AIShell"]),
  ],
  swiftLanguageModes: [.v6]
)
