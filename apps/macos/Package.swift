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
    .testTarget(name: "AICoreTests", dependencies: ["AICore"]),
  ],
  swiftLanguageModes: [.v6]
)
