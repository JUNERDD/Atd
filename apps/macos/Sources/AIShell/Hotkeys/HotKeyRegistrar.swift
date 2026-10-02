import AICore
import Foundation
import OSLog

/// Keeps the registered global hot keys equal to the set the page pushes, one diff at a time.
/// Nothing is cached across launches (grill decision Q9): the panel page loads at launch and
/// pushes the set, and until then no shortcut is registered.
final class HotKeyRegistrar {
  private let carbon = CarbonHotKeys()
  private var registered: [String: (combination: HotKeyCombination, token: UInt32)] = [:]
  private let onPress: @MainActor (String) -> Void

  /// `onPress` receives the id of the pressed entry.
  init(onPress: @escaping @MainActor (String) -> Void) {
    self.onPress = onPress
  }

  /// Registers the difference to `desired` and reports every entry once, in order. The page
  /// words failures by reason; the details go to the log.
  func apply(_ desired: [ShortcutRegistration]) -> [ShortcutResult] {
    let plan = HotKeyPlanner.plan(
      desired: desired, registered: registered.mapValues(\.combination),
      reserved: CarbonHotKeys.reservedBySystem())
    for id in plan.unregister {
      if let entry = registered.removeValue(forKey: id) { carbon.unregister(entry.token) }
    }
    var failures = plan.failures
    for (id, combination) in plan.register {
      switch carbon.register(combination, onPress: { [onPress] in onPress(id) }) {
      case .success(let token): registered[id] = (combination, token)
      case .failure(let status): failures[id] = .registrationFailed(status: status.value)
      }
    }
    var reported: Set<String> = []
    return desired.compactMap { request in
      guard reported.insert(request.id).inserted else { return nil }
      guard let failure = failures[request.id] else { return .registered(.init(id: request.id)) }
      Self.log.info(
        "Shortcut \(request.id, privacy: .public) not registered: \(Self.detail(failure))")
      return .notRegistered(.init(id: request.id, reason: failure.reason))
    }
  }

  private static let log = Logger(subsystem: "com.junerdd.ai", category: "hotkeys")

  private static func detail(_ failure: HotKeyFailure) -> String {
    switch failure {
    case .invalidAccelerator(let error): "invalid accelerator (\(error))"
    case .reservedBySystem: "reserved by a macOS keyboard shortcut"
    case .sameCombination(let holder): "same combination as \(holder)"
    case .registrationFailed(let status): "RegisterEventHotKey \(CarbonStatus(value: status).name)"
    }
  }

  func unregisterAll() {
    for entry in registered.values { carbon.unregister(entry.token) }
    registered.removeAll()
  }
}
