import AICore
import Foundation

/// The outcome of one entry of a pushed registration set, as the page receives it. The page
/// words it and records failures in its shortcut errors.
struct HotKeyReport: Encodable, Equatable {
  let id: String
  let registered: Bool
  /// `invalidAccelerator`, `reservedBySystem`, `sameCombination` or `registrationFailed`.
  let error: String?
  /// The accelerator problem, the id holding the same combination, or the Carbon error name.
  let detail: String?
  /// The `OSStatus` of a failed registration.
  let status: Int32?

  static func success(_ id: String) -> HotKeyReport {
    HotKeyReport(id: id, registered: true, error: nil, detail: nil, status: nil)
  }

  static func failure(_ id: String, _ failure: HotKeyFailure) -> HotKeyReport {
    switch failure {
    case .invalidAccelerator(let error):
      HotKeyReport(
        id: id, registered: false, error: "invalidAccelerator", detail: "\(error)", status: nil)
    case .reservedBySystem:
      HotKeyReport(id: id, registered: false, error: "reservedBySystem", detail: nil, status: nil)
    case .sameCombination(let holder):
      HotKeyReport(
        id: id, registered: false, error: "sameCombination", detail: holder, status: nil)
    case .registrationFailed(let status):
      HotKeyReport(
        id: id, registered: false, error: "registrationFailed",
        detail: CarbonStatus(value: status).name, status: status)
    }
  }
}

/// Keeps the registered global hot keys equal to the set the page pushes, one diff at a time.
/// Nothing is cached across launches (grill decision Q9): the panel page loads at launch and
/// pushes the set, and until then no shortcut is registered.
@MainActor
final class HotKeyRegistrar {
  private let carbon = CarbonHotKeys()
  private var registered: [String: (combination: HotKeyCombination, token: UInt32)] = [:]
  private let onPress: @MainActor (String) -> Void

  /// `onPress` receives the id of the pressed entry.
  init(onPress: @escaping @MainActor (String) -> Void) {
    self.onPress = onPress
  }

  func apply(_ desired: [HotKeyRequest]) -> [HotKeyReport] {
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
      return failures[request.id].map { .failure(request.id, $0) } ?? .success(request.id)
    }
  }

  func unregisterAll() {
    for entry in registered.values { carbon.unregister(entry.token) }
    registered.removeAll()
  }
}
