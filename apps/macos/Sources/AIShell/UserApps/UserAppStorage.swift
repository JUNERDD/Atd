import AICore
import Foundation
import OSLog
import WebKit

/// What the shell keeps per user app outside the service: its compiled content rule list, its
/// website data store, and its window frame. Clearing an app's data removes the store; deleting
/// the app removes all three.
///
/// The service forgets an app's `dataStoreId` when the app is deleted, so the shell remembers
/// the id of every app it opened; that is how it finds the store to remove afterwards. An app
/// never opened in this shell has no store.
///
/// WebKit crashes when the static data store API runs before any `WKWebView` exists in the
/// process (T1). The shell creates the panel's web view before this object, and nothing here
/// touches the static API from an initializer.
final class UserAppStorage {
  private let defaults: UserDefaults
  private var rules: [String: WKContentRuleList] = [:]
  private static let dataStoresKey = "userApps.dataStores"
  private static let framesKey = "userApps.frames"
  /// Data stores whose removal failed; retried at the next launch.
  private static let pendingRemovalsKey = "userApps.pendingRemovals"
  private static let log = Logger(subsystem: "com.junerdd.ai", category: "user-apps")

  init(defaults: UserDefaults) {
    self.defaults = defaults
  }

  // MARK: Rule lists

  /// The app's rule list, compiled once per launch (about 100 ms). The store persists it under
  /// `~/Library/WebKit/<bundle id>/ContentRuleLists/` until the app is deleted
  /// (``clearData(appId:forget:)``).
  func ruleList(appId: String) async throws -> WKContentRuleList {
    if let cached = rules[appId] { return cached }
    let compiled = try await WKContentRuleListStore.default().compileContentRuleList(
      forIdentifier: UserAppContentPolicy.ruleListIdentifier(appId: appId),
      encodedContentRuleList: UserAppContentPolicy.ruleList(appId: appId))
    guard let compiled else { throw ShellServiceError("The app's content rules did not compile.") }
    rules[appId] = compiled
    return compiled
  }

  // MARK: Remembered state

  func rememberDataStore(_ id: UUID, appId: String) {
    var stores = defaults.dictionary(forKey: Self.dataStoresKey) as? [String: String] ?? [:]
    guard stores[appId] != id.uuidString else { return }
    stores[appId] = id.uuidString
    defaults.set(stores, forKey: Self.dataStoresKey)
  }

  func frame(appId: String) -> ScreenRect? {
    let frames = defaults.dictionary(forKey: Self.framesKey) as? [String: [Double]] ?? [:]
    guard let values = frames[appId], values.count == 4 else { return nil }
    return ScreenRect(x: values[0], y: values[1], width: values[2], height: values[3])
  }

  func rememberFrame(_ frame: ScreenRect, appId: String) {
    var frames = defaults.dictionary(forKey: Self.framesKey) as? [String: [Double]] ?? [:]
    frames[appId] = [frame.x, frame.y, frame.width, frame.height]
    defaults.set(frames, forKey: Self.framesKey)
  }

  // MARK: Clearing and deletion

  /// `userApp.clearData`: removes the app's website data store. With `forget` (the app was
  /// deleted) the rule list, the frame and the remembered store id go too; otherwise the id
  /// stays, and the app's next window starts with an empty store under the same id. The caller
  /// has closed the app's window and released its web view first: WebKit refuses to remove a
  /// store a web view still holds. False when the store is still not removed after the retries;
  /// the next launch tries again.
  func clearData(appId: String, forget: Bool) async -> Bool {
    var stores = defaults.dictionary(forKey: Self.dataStoresKey) as? [String: String] ?? [:]
    let store = stores[appId].flatMap(UUID.init(uuidString:))
    if forget {
      rules[appId] = nil
      try? await WKContentRuleListStore.default().removeContentRuleList(
        forIdentifier: UserAppContentPolicy.ruleListIdentifier(appId: appId))
      var frames = defaults.dictionary(forKey: Self.framesKey) as? [String: [Double]] ?? [:]
      frames[appId] = nil
      defaults.set(frames, forKey: Self.framesKey)
      stores[appId] = nil
      defaults.set(stores, forKey: Self.dataStoresKey)
    }
    // An app never opened in this shell has no store.
    guard let store else { return true }
    return await removeDataStore(store)
  }

  /// Retries the removals a previous launch could not finish. Called once the panel's web view
  /// exists, before any app's web view does, so no store is in use.
  func retryPendingRemovals() {
    let pending = defaults.stringArray(forKey: Self.pendingRemovalsKey) ?? []
    guard !pending.isEmpty else { return }
    defaults.removeObject(forKey: Self.pendingRemovalsKey)
    Task {
      for store in pending.compactMap(UUID.init(uuidString:)) { await removeDataStore(store) }
    }
  }

  /// `remove(forIdentifier:)` fails with "Data store is in use" until WebKit has let go of the
  /// closed web view's processes, so it is retried with backoff. A store still not removed is
  /// left for the next launch (``retryPendingRemovals()``) rather than cleared through a web
  /// view: opening one on it would only recreate it.
  @discardableResult
  private func removeDataStore(_ store: UUID) async -> Bool {
    let delays: [Duration] = [
      .zero, .milliseconds(250), .milliseconds(500), .seconds(1), .seconds(2), .seconds(4),
    ]
    var lastError: (any Error)?
    for delay in delays {
      try? await Task.sleep(for: delay)
      do {
        try await WKWebsiteDataStore.remove(forIdentifier: store)
        return true
      } catch {
        lastError = error
      }
    }
    Self.log.error(
      "An app's data store was not removed: \(String(describing: lastError), privacy: .public)")
    var pending = defaults.stringArray(forKey: Self.pendingRemovalsKey) ?? []
    if !pending.contains(store.uuidString) { pending.append(store.uuidString) }
    defaults.set(pending, forKey: Self.pendingRemovalsKey)
    return false
  }
}
