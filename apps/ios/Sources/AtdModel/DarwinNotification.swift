import Foundation

/// Darwin notifications: a name and nothing else, delivered across processes. The app and the
/// keyboard use one to tell each other that a shared file changed.
public enum DarwinNotification {
  public static func post(_ name: String) {
    CFNotificationCenterPostNotification(
      CFNotificationCenterGetDarwinNotifyCenter(), CFNotificationName(name as CFString), nil, nil,
      true)
  }
}

/// Observes one Darwin notification name for as long as the observer lives. `changes` yields once
/// per delivery; deliveries that arrive while nobody reads are coalesced into one.
public final class DarwinObserver: Sendable {
  public let changes: AsyncStream<Void>
  private let continuation: AsyncStream<Void>.Continuation
  private let name: String

  public init(name: String) {
    self.name = name
    (changes, continuation) = AsyncStream.makeStream(bufferingPolicy: .bufferingNewest(1))
    CFNotificationCenterAddObserver(
      CFNotificationCenterGetDarwinNotifyCenter(), Unmanaged.passUnretained(self).toOpaque(),
      { _, observer, _, _, _ in
        guard let observer else { return }
        Unmanaged<DarwinObserver>.fromOpaque(observer).takeUnretainedValue().continuation.yield()
      }, name as CFString, nil, .deliverImmediately)
  }

  deinit {
    CFNotificationCenterRemoveObserver(
      CFNotificationCenterGetDarwinNotifyCenter(), Unmanaged.passUnretained(self).toOpaque(),
      CFNotificationName(name as CFString), nil)
    continuation.finish()
  }
}
