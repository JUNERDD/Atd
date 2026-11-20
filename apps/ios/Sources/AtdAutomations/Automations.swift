import ActivityKit

/// Context automations (自动化) that Shortcuts personal automations run, step by step, with a Live
/// Activity. The app and the widget extension (the Live Activity views) both link this module.
///
/// Stub (F0a): WS-E replaces this file.
public enum AutomationLaunch {
  /// Called once while the app launches (`AtdAppLaunch`), before launch finishes, which is when
  /// background task handlers must be registered with `BGTaskScheduler`.
  @MainActor public static func prepare() {}
}

/// What an automation's Live Activity shows while it runs. Stub (F0a): WS-E defines it.
public struct AutomationActivityAttributes: ActivityAttributes, Sendable {
  public struct ContentState: Codable, Hashable, Sendable {
    public init() {}
  }

  public init() {}
}

/// What the NFC focus timer's Live Activity shows. Stub (F0a): WS-E defines it.
public struct FocusActivityAttributes: ActivityAttributes, Sendable {
  public struct ContentState: Codable, Hashable, Sendable {
    public init() {}
  }

  public init() {}
}
