/// Why an entry is not registered.
public enum HotKeyFailure: Equatable, Sendable {
  case invalidAccelerator(AcceleratorError)
  /// An enabled macOS keyboard shortcut (System Settings › Keyboard › Keyboard Shortcuts)
  /// already uses the combination; the system would win the key press.
  case reservedBySystem
  /// An earlier entry of the same set has the same combination.
  case sameCombination(asId: String)
  /// `RegisterEventHotKey` refused it with this `OSStatus`.
  case registrationFailed(status: Int32)
  /// A double-tap, while the shell may not watch the keyboard (no Accessibility trust).
  case needsAccessibility

  /// How the page words it: only an accelerator Swift cannot express is `invalid`; the other
  /// failures mean another holder has the combination.
  public var reason: ShortcutResult.NotRegistered.Reason {
    if case .invalidAccelerator = self { return .invalid }
    return .unavailable
  }
}

extension HotKeyCombination {
  /// A combination as another source describes it (the system's symbolic hot keys).
  public static func carbon(keyCode: UInt32, modifiers: HotKeyModifiers) -> HotKeyCombination {
    HotKeyCombination(keyCode: keyCode, modifiers: modifiers)
  }
}

/// A combination macOS reserves, from `CopySymbolicHotKeys`. The raw modifiers carry more
/// than the four Carbon modifier bits; only those four take part in the comparison.
public struct ReservedHotKey: Equatable, Sendable {
  public let keyCode: UInt32
  public let carbonModifiers: UInt32

  public init(keyCode: UInt32, carbonModifiers: UInt32) {
    self.keyCode = keyCode
    self.carbonModifiers = carbonModifiers
  }

  public var combination: HotKeyCombination {
    let known: HotKeyModifiers = [.command, .shift, .option, .control]
    return .carbon(
      keyCode: keyCode,
      modifiers: HotKeyModifiers(rawValue: carbonModifiers).intersection(known))
  }
}

/// How to move from the registered hot keys to the pushed set.
public struct HotKeyPlan: Equatable, Sendable {
  /// Registered ids to release first, so a combination moving between ids is free again.
  public var unregister: [String] = []
  /// Entries to register, in the pushed order.
  public var register: [(id: String, trigger: HotKeyTrigger)] = []
  /// Entries already registered with the same trigger.
  public var keep: [String] = []
  /// Entries that will not be registered, and why.
  public var failures: [String: HotKeyFailure] = [:]

  public static func == (lhs: HotKeyPlan, rhs: HotKeyPlan) -> Bool {
    lhs.unregister == rhs.unregister && lhs.keep == rhs.keep && lhs.failures == rhs.failures
      && lhs.register.map(\.id) == rhs.register.map(\.id)
      && lhs.register.map(\.trigger) == rhs.register.map(\.trigger)
  }
}

/// Diffs the pushed registration set against what is registered (grill decision Q9 and plan
/// decision R8). Only successful registrations are remembered, so an entry that failed is
/// attempted again on every push; a trigger change of a kept id re-registers it. A double-tap is
/// planned like a chord: never reserved by the system (macOS reserves only chords), and wanted
/// only while `doubleTapAvailable`, so losing Accessibility releases it and regaining it
/// registers it on the next plan. Conflicts between entries stay the page's job
/// (`commandShortcutHolder`); the checks here only keep the set registrable. Results are keyed by
/// id, so a repeated id is ignored after its first entry.
public enum HotKeyPlanner {
  public static func plan(
    desired: [ShortcutRegistration],
    registered: [String: HotKeyTrigger],
    reserved: [ReservedHotKey],
    doubleTapAvailable: Bool
  ) -> HotKeyPlan {
    let reservedTriggers = Set(reserved.map { HotKeyTrigger.chord($0.combination) })
    var plan = HotKeyPlan()
    var wanted: [String: HotKeyTrigger] = [:]
    var claimed: [HotKeyTrigger: String] = [:]
    var seen: Set<String> = []
    for request in desired {
      guard seen.insert(request.id).inserted else { continue }
      let trigger: HotKeyTrigger
      do {
        trigger = try Accelerator.parse(request.accelerator)
      } catch {
        plan.failures[request.id] = .invalidAccelerator(error)
        continue
      }
      if reservedTriggers.contains(trigger) {
        plan.failures[request.id] = .reservedBySystem
      } else if let holder = claimed[trigger] {
        plan.failures[request.id] = .sameCombination(asId: holder)
      } else if case .doubleTap = trigger, !doubleTapAvailable {
        plan.failures[request.id] = .needsAccessibility
      } else {
        claimed[trigger] = request.id
        wanted[request.id] = trigger
      }
    }
    for (id, trigger) in registered.sorted(by: { $0.key < $1.key }) where wanted[id] != trigger {
      plan.unregister.append(id)
    }
    var planned: Set<String> = []
    for request in desired where planned.insert(request.id).inserted {
      guard let trigger = wanted[request.id] else { continue }
      if registered[request.id] == trigger {
        plan.keep.append(request.id)
      } else {
        plan.register.append((request.id, trigger))
      }
    }
    return plan
  }
}
