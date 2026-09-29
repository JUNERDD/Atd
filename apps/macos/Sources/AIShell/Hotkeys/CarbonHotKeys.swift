import AICore
import Carbon.HIToolbox

/// The thinnest Carbon wrapper that keeps `RegisterEventHotKey`'s `OSStatus` (plan decision
/// R8, from spike S9). Registrations are non-exclusive, like Electron's `globalShortcut`: they
/// never take a combination away from another app, and no other app's registration makes them
/// fail. Real errors (a repeat within this process, an invalid key) still come back as status.
/// HotKey is not used: it drops the status and is unmaintained; only its idea of mapping key
/// names to codes survives, in `Accelerator`.
@MainActor
final class CarbonHotKeys {
  private static let signature: OSType = 0x4149_4B59  // 'AIKY'

  private var refs: [UInt32: EventHotKeyRef] = [:]
  private var actions: [UInt32: @MainActor () -> Void] = [:]
  private var nextID: UInt32 = 0
  private var handler: EventHandlerRef?

  /// Registers the combination; returns its token or the failing `OSStatus`.
  func register(_ combination: HotKeyCombination, onPress: @escaping @MainActor () -> Void)
    -> Result<UInt32, CarbonStatus>
  {
    let installed = installHandlerIfNeeded()
    guard installed == noErr else { return .failure(CarbonStatus(value: installed)) }
    nextID += 1
    var ref: EventHotKeyRef?
    let status = RegisterEventHotKey(
      combination.keyCode, combination.modifiers.rawValue,
      EventHotKeyID(signature: Self.signature, id: nextID), GetEventDispatcherTarget(), 0, &ref)
    guard status == noErr, let ref else { return .failure(CarbonStatus(value: status)) }
    refs[nextID] = ref
    actions[nextID] = onPress
    return .success(nextID)
  }

  func unregister(_ token: UInt32) {
    if let ref = refs.removeValue(forKey: token) { UnregisterEventHotKey(ref) }
    actions[token] = nil
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

  fileprivate func fire(_ id: UInt32) { actions[id]?() }

  private func installHandlerIfNeeded() -> OSStatus {
    guard handler == nil else { return noErr }
    var spec = EventTypeSpec(
      eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed))
    let context = Unmanaged.passUnretained(self).toOpaque()
    return InstallEventHandler(
      GetEventDispatcherTarget(),
      { _, event, context in
        var hotKeyID = EventHotKeyID()
        let status = GetEventParameter(
          event, EventParamName(kEventParamDirectObject), EventParamType(typeEventHotKeyID), nil,
          MemoryLayout<EventHotKeyID>.size, nil, &hotKeyID)
        guard status == noErr, hotKeyID.signature == CarbonHotKeys.signature, let context else {
          return OSStatus(eventNotHandledErr)
        }
        // The event dispatcher target delivers on the main run loop.
        let id = hotKeyID.id
        MainActor.assumeIsolated {
          Unmanaged<CarbonHotKeys>.fromOpaque(context).takeUnretainedValue().fire(id)
        }
        return noErr
      }, 1, &spec, context, &handler)
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
