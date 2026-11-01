import AICore
import AppKit
import ApplicationServices

/// Allow-listed build and platform facts shared by every support profile.
enum DiagnosticEnvironment {
  static func read() -> JSONValue {
    let info = Bundle.main.infoDictionary ?? [:]
    #if arch(arm64)
      let architecture = "arm64"
    #else
      let architecture = "x86_64"
    #endif
    return .object([
      "schemaVersion": .number(2),
      "os": .string(ProcessInfo.processInfo.operatingSystemVersionString),
      "architecture": .string(architecture),
      "appVersion": .string(info["CFBundleShortVersionString"] as? String ?? ""),
      "appBuild": .string(info["CFBundleVersion"] as? String ?? ""),
      "revision": .string(info["AtdDiagnosticRevision"] as? String ?? ""),
      "bundleId": Bundle.main.bundleIdentifier.map(JSONValue.string) ?? .null,
      "accessibilityTrusted": .bool(AXIsProcessTrusted()),
      "screenCaptureAllowed": .bool(CGPreflightScreenCaptureAccess()),
      "listenEventAllowed": .bool(CGPreflightListenEventAccess()),
      "showInDockPreference": .bool(UserDefaults.standard.bool(forKey: "app.showInDock")),
      "pinnedPreference": .bool(UserDefaults.standard.bool(forKey: "panel.pinned")),
      "screens": .array(
        NSScreen.screens.map { screen in
          .object([
            "frame": rect(screen.frame),
            "visibleFrame": rect(screen.visibleFrame),
            "scale": .number(screen.backingScaleFactor),
          ])
        }),
    ])
  }

  private static func rect(_ rect: CGRect) -> JSONValue {
    .array([rect.origin.x, rect.origin.y, rect.width, rect.height].map { .number(Double($0)) })
  }
}
