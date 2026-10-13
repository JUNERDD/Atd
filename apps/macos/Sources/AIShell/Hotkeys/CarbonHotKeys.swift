import AICore
import Carbon.HIToolbox

/// The thinnest Carbon wrapper that keeps `RegisterEventHotKey`'s `OSStatus` (plan decision
/// R8, from spike S9). Registrations are non-exclusive: they
/// never take a combination away from another app, and no other app's registration makes them
/// fail. Real errors (a repeat within this process, an invalid key) still come back as status.
/// HotKey is not used: it drops the status and is unmaintained; only its idea of mapping key
/// names to codes survives, in `Accelerator`.
///
/// Each instance installs its own handler and tags its registrations with its own
/// ``signature``; a handler passes on a press it did not register, so instances never fire each
/// other's actions. A registration may also follow its release (`kEventHotKeyReleased`), which
/// a command shortcut's hold needs (``ShortcutHolds``).
final class CarbonHotKeys {
  /// The global shortcuts' signature ('AIKY').
  static let shortcutSignature: OSType = 0x4149_4B59

  private let signature: OSType
  private var refs: [UInt32: EventHotKeyRef] = [:]
  private var actions: [UInt32: @MainActor () -> Void] = [:]
  private var releases: [UInt32: @MainActor () -> Void] = [:]
  private var nextID: UInt32 = 0
  private var handler: EventHandlerRef?

  init(signature: OSType = CarbonHotKeys.shortcutSignature) {
    self.signature = signature
  }

  /// Registers the combination; returns its token or the failing `OSStatus`. `onRelease`, when
  /// given, runs as the combination's key comes back up.
  func register(
    _ combination: HotKeyCombination, onPress: @escaping @MainActor () -> Void,
    onRelease: (@MainActor () -> Void)? = nil
  ) -> Result<UInt32, CarbonStatus> {
    let installed = installHandlerIfNeeded()
    guard installed == noErr else { return .failure(CarbonStatus(value: installed)) }
    nextID += 1
    var ref: EventHotKeyRef?
    let status = RegisterEventHotKey(
      combination.keyCode, combination.modifiers.rawValue,
      EventHotKeyID(signature: signature, id: nextID), GetEventDispatcherTarget(), 0, &ref)
    guard status == noErr, let ref else { return .failure(CarbonStatus(value: status)) }
    refs[nextID] = ref
    actions[nextID] = onPress
    releases[nextID] = onRelease
    return .success(nextID)
  }

  func unregister(_ token: UInt32) {
    if let ref = refs.removeValue(forKey: token) { UnregisterEventHotKey(ref) }
    actions[token] = nil
    releases[token] = nil
  }

  /// Combinations the system's own keyboard shortcuts use while enabled (Spotlight, input
  /// source switching, Mission Control, screenshots…). Empty when the list is unavailable.
  static func reservedBySystem() -> [ReservedHotKey] {
    var unmanaged: Unmanaged<CFArray>?
    guard CopySymbolicHotKeys(&unmanaged) == noErr,
      let entries = unmanaged?.takeRetainedValue() as? [[String: Any]]
    else { return [] }
    return entries.compactMap { entry in
      guard (entry[kHISymbolicHotKeyEnabled] as? Bool) == true,
        let code = (entry[kHISymbolicHotKeyCode] as? NSNumber)?.uint32Value,
        let modifiers = (entry[kHISymbolicHotKeyModifiers] as? NSNumber)?.uint32Value
      else { return nil }
      return ReservedHotKey(keyCode: code, carbonModifiers: modifiers)
    }
  }

  /// Runs the action of a press, or of a release, this instance registered; false for any
  /// other, and for the release of a registration that does not follow it.
  fileprivate func fire(_ id: EventHotKeyID, released: Bool) -> Bool {
    guard id.signature == signature,
      let action = released ? releases[id.id] : actions[id.id]
    else { return false }
    action()
    return true
  }

  private func installHandlerIfNeeded() -> OSStatus {
    guard handler == nil else { return noErr }
    var specs = [
      EventTypeSpec(
        eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed)),
      EventTypeSpec(
        eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyReleased)),
    ]
    let context = Unmanaged.passUnretained(self).toOpaque()
    return InstallEventHandler(
      GetEventDispatcherTarget(),
      { _, event, context in
        var hotKeyID = EventHotKeyID()
        let status = GetEventParameter(
          event, EventParamName(kEventParamDirectObject), EventParamType(typeEventHotKeyID), nil,
          MemoryLayout<EventHotKeyID>.size, nil, &hotKeyID)
        guard status == noErr, let context else { return OSStatus(eventNotHandledErr) }
        let released = GetEventKind(event) == UInt32(kEventHotKeyReleased)
        // The event dispatcher target delivers on the main run loop.
        let fired = hotKeyID
        let handled = MainActor.assumeIsolated {
          Unmanaged<CarbonHotKeys>.fromOpaque(context).takeUnretainedValue()
            .fire(fired, released: released)
        }
        return handled ? noErr : OSStatus(eventNotHandledErr)
      }, specs.count, &specs, context, &handler)
  }
}

/// A Carbon `OSStatus` with the names of the hot key errors.
struct CarbonStatus: Error, Equatable {
  let value: OSStatus

  var name: String {
    switch Int(value) {
    case eventHotKeyExistsErr: "eventHotKeyExistsErr"
    case eventHotKeyInvalidErr: "eventHotKeyInvalidErr"
    case paramErr: "paramErr"
    default: "OSStatus"
    }
  }
}
