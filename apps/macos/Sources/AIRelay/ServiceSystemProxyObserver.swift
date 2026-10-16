import Foundation
import SystemConfiguration

/// System Configuration delivers proxy changes on the main queue. One observer belongs to the
/// shell's control connection; reconnecting starts with a fresh snapshot, including proxy-off.
final class ServiceSystemProxyObserver {
  private var store: SCDynamicStore?
  private var previous: ServiceSystemProxy.Snapshot?
  private let changed: @MainActor (ServiceSystemProxy.Snapshot) -> Void

  init(changed: @escaping @MainActor (ServiceSystemProxy.Snapshot) -> Void) {
    self.changed = changed
  }

  func start() {
    guard store == nil else { return }
    var context = SCDynamicStoreContext(
      version: 0, info: Unmanaged.passUnretained(self).toOpaque(),
      retain: nil, release: nil, copyDescription: nil)
    let session = SCDynamicStoreCreate(
      nil, "Atd system proxy observer" as CFString,
      { _, _, context in
        guard let context else { return }
        MainActor.assumeIsolated {
          Unmanaged<ServiceSystemProxyObserver>.fromOpaque(context).takeUnretainedValue().refresh()
        }
      }, &context)
    let key = SCDynamicStoreKeyCreateProxies(nil)
    if let session,
      SCDynamicStoreSetNotificationKeys(session, [key] as CFArray, nil),
      SCDynamicStoreSetDispatchQueue(session, .main)
    {
      store = session
    } else {
      RelayLog.service.error("Could not observe system proxy changes.")
    }
    refresh()
  }

  func stop() {
    if let store { SCDynamicStoreSetDispatchQueue(store, nil) }
    store = nil
    previous = nil
  }

  private func refresh() {
    guard let snapshot = ServiceSystemProxy.current(), snapshot != previous else { return }
    previous = snapshot
    changed(snapshot)
  }

  isolated deinit {
    if let store { SCDynamicStoreSetDispatchQueue(store, nil) }
  }
}
