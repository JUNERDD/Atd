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
/// `AIShell`, embeds the driver helper built from `AIComputerDriver`, and supplies the bundle,
/// Info.plist and signing.
let package = Package(
  name: "AIMac",
  platforms: [.macOS(.v15)],
  products: [
    .library(name: "AICore", targets: ["AICore"]),
    .library(name: "AIShell", targets: ["AIShell"]),
    // Shared with the WidgetKit and Finder Sync extensions (`AtdWidgets`, `AtdFinderSync` in
    // project.yml).
    .library(name: "AIWidgetModel", targets: ["AIWidgetModel"]),
    .library(name: "AIWidgetRender", targets: ["AIWidgetRender"]),
    // The background computer-use driver, spawned by the shell as a direct child. Isolated so a
    // SkyLight/AX crash or hang cannot take the shell down with it. The shipped helper is the
    // XcodeGen tool target of the same name (`project.yml`), which compiles the CLI's `main.swift`
    // against the library product and embeds the result in `Contents/MacOS`; the executable
    // product is the same entry point for `swift build`, which needs no Xcode project.
    .library(name: "AIComputerDriver", targets: ["AIComputerDriver"]),
    .executable(name: "atd-computer-driver", targets: ["AtdComputerDriverCLI"]),
  ],
  // Direct dependencies are pinned exactly; Package.resolved (checked in) pins their transitive
  // dependencies, and scripts/build.mjs makes xcodebuild use only those versions.
  dependencies: [
    .package(url: "https://github.com/sparkle-project/Sparkle", exact: "2.10.1"),
    // The official MCP SDK (Apache-2.0/MIT, licenses/mcp-swift-sdk-LICENSE): the client side of
    // the private stdio MCP connection to the computer-use browser worker
    // (Computer/Engines/Browser).
    .package(url: "https://github.com/modelcontextprotocol/swift-sdk", exact: "0.11.0"),
  ],
  targets: [
    // The frozen computer-use driver protocol: request/response/event Codable unions, the
    // element, receipt and failure payloads. Foundation-only and dependency-free so both the
    // driver executable and AICore (host side) can share the wire types without AICore ever
    // linking the driver. The protocol is documented in Sources/AIComputerDriverKit.
    .target(name: "AIComputerDriverKit"),
    // The background driver's engine: AX reads and actions, window-routed event recipes, the
    // SkyLight private-symbol bridge, occlusion keep-alive and off-Space capture. nonisolated
    // (deliberately NOT main-actor, unlike the app targets) because it runs per-pid serial
    // executors off the main thread; it links only AIComputerDriverKit and Apple frameworks.
    .target(name: "AIComputerDriver", dependencies: ["AIComputerDriverKit"]),
    // The `atd-computer-driver` executable: a thin main that runs the driver server over
    // stdin/stdout. The shell spawns it directly (inheriting Atd's TCC grants).
    .executableTarget(name: "AtdComputerDriverCLI", dependencies: ["AIComputerDriver"]),
    // Pure, Foundation-only policy: relay normalization and allow-listing, stream frame rules,
    // accelerator conversion and supervisor timing. No AppKit or WebKit, so all of it is
    // unit-testable. Depends on the driver kit so host code reads `DriverElement` and the
    // receipt/failure types without linking the driver executable's engine.
    .target(name: "AICore", dependencies: ["AIComputerDriverKit"]),
    // The app: windows, menus, hot keys and native capabilities, composed with the relay and
    // the service (Debug connects to `pnpm dev`, Release supervises the bundled service), and
    // Release builds' Sparkle updater.
    .target(
      name: "AIShell",
      dependencies: [
        "AICore", "AIRelay", "AIWidgetModel", "AIWidgetRender",
        .product(name: "Sparkle", package: "Sparkle"),
        .product(name: "MCP", package: "swift-sdk"),
      ],
      swiftSettings: approachableConcurrency),
    // The renderer relay, virtual socket pipe, control stream and service access: Foundation,
    // WebKit and AICore, no AppKit windows. AIShell wires it to its web views.
    .target(
      name: "AIRelay", dependencies: ["AICore", "AIWidgetModel"],
      swiftSettings: approachableConcurrency),
    // Desktop widgets' data, shared by the shell (the only writer) and the sandboxed WidgetKit
    // extension (a reader): the generated view tree and sync types, the files' layout and the
    // widget link; plus the Finder Sync extension's hand-off to the shell (FinderHandoff).
    // Foundation and AICore only.
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
