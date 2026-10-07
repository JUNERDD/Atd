import CoreGraphics

/// Seconds since the last keyboard, mouse or trackpad input in the login session. Reading it
/// needs no permission (no Accessibility or Input Monitoring grant): the system keeps the counter
/// for every process.
enum SystemIdleTime {
  /// `kCGAnyInputEventType`, which Swift's `CGEventType` does not name: the counter of any input.
  private static let anyInput = CGEventType(rawValue: ~0)

  static func seconds() -> Double {
    guard let anyInput else { return 0 }
    return CGEventSource.secondsSinceLastEventType(.combinedSessionState, eventType: anyInput)
  }
}
