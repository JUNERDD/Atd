// swift-tools-version: 6.2
import PackageDescription

/// All shell logic lives in this package; the XcodeGen App target (`project.yml`) only links
/// `AIShell` and supplies the bundle, Info.plist and signing.
let package = Package(
  name: "AIMac",
  platforms: [.macOS(.v26)],
  products: [
    .library(name: "AICore", targets: ["AICore"]),
    .library(name: "AIShell", targets: ["AIShell"]),
  ],
  targets: [
    // Pure, Foundation-only policy: relay normalization and allow-listing, stream frame rules,
    // accelerator conversion and supervisor timing. No AppKit or WebKit, so all of it is
    // unit-testable.
    .target(name: "AICore"),
    // AppKit/WebKit integration that applies the AICore policy.
    .target(name: "AIShell", dependencies: ["AICore"]),
    // The renderer relay, virtual socket pipe, control stream and service access: Foundation,
    // WebKit and AICore, no AppKit windows. AIShell and the app wire it to their web views.
    .target(name: "AIRelay", dependencies: ["AICore"]),
    .testTarget(name: "AICoreTests", dependencies: ["AICore"]),
    // Runs a real WKWebView against a local stub service; see RelayIntegrationTests.
    .testTarget(name: "AIRelayTests", dependencies: ["AIRelay", "AICore"]),
  ],
  swiftLanguageModes: [.v6]
)
