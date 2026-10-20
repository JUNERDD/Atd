import AIComputerDriverKit
import AICore
import AppKit

/// Resolving an application binding (spec §11, plan Clarifying Questions): the app installed at
/// the binding's path, still signed as recorded and running once, and its root window by the
/// root-window rule (``NativeRootWindow``): the main window, else the focused one, else the
/// front-most one. Resolving never asks the person; the app's other top-level windows are listed
/// as `ownedWindow` surfaces. An app that is not running is started without activating it first,
/// for attended and unattended runs alike (``launchInBackground(_:_:until:)``).
extension NativeEngine {
  func resolve(
    _ binding: TargetBindingWire, generation hostGeneration: Int, context: EngineResolveContext
  ) async throws(ComputerFailure) -> TargetRefWire {
    guard case .native(let native) = binding else {
      throw ComputerFailure(.unsupported, "The native engine drives applications only.")
    }
    try context.check()
    try Self.requireUnlockedSession()
    try requireAccessibility()
    let app: NSRunningApplication
    switch await NativeApplicationTarget.state(native) {
    case .success(.running(let running)): app = running
    case .success(.notRunning(let identity)):
      app = try await launchInBackground(native, identity, until: context.deadline)
    case .failure(let failure): throw failure
    }
    let pid = app.processIdentifier
    guard let start = NativeTargetProbe.processStart(pid: pid) else {
      throw ComputerFailure(.targetUnavailable, "\(native.appName) quit while it was resolved.")
    }
    // An app launched just now (here or by requestAccess) may not show its window yet.
    try await awaitFirstWindow(pid: pid, start: start, context: context)
    let path = native.appPath
    let (root, version) = await NativeTargetProbe.detached {
      (NativeSurfaceProbe.rootWindow(pid: pid), NativeAppIdentity.version(path: path))
    }
    try context.check()
    guard NativeTargetProbe.processStart(pid: pid) == start else { throw Self.changed }
    guard let root else {
      throw ComputerFailure(
        .targetUnavailable,
        "Needs preparing: \(native.appName) has no open window to work in on this Mac.")
    }
    let place = NativeSurfaceRead(
      surfaceRefId: nil, pid: Int(pid), windowId: root.windowId, root: .window, cropFrame: nil)
    let toolkit = (try? await probe(place, operation: nil))?.toolkit
    try context.check()
    return try mint(
      native, app: AppIdentity(bundleId: native.bundleId, version: version), pid: pid,
      start: start, window: root, toolkit: toolkit, hostGeneration: hostGeneration)
  }

  /// Mints the ref of a resolved root window and starts its surface set with the root alone.
  /// A ref the same binding had before is replaced, and the windows it pinned pass to the new
  /// one.
  private func mint(
    _ native: TargetBindingWire.Native, app: AppIdentity, pid: pid_t, start: UInt64,
    window: NativeSurfaceProbe.AppWindow, toolkit: DriverToolkit?, hostGeneration: Int
  ) throws(ComputerFailure) -> TargetRefWire {
    guard let engineGeneration = generation else { throw Self.notRunning }
    let facts = routeFacts(for: nil, toolkit: toolkit ?? .unknown, kind: nil)
    let ref = TargetRefWire(
      id: "atd.\(engineGeneration).\(UUID().uuidString.lowercased())",
      bindingId: native.bindingId, bindingRevision: native.revision,
      hostGeneration: hostGeneration, engine: .atd, engineGeneration: engineGeneration,
      native: .init(pid: Int(pid), processStart: String(start), windowId: window.windowId),
      capabilities: Self.capabilities(facts))
    let replaced = Set(targets.filter { $0.value.ref.bindingId == native.bindingId }.keys)
    for id in replaced { targets[id] = nil }
    for (key, holders) in pinned where !holders.isDisjoint(with: replaced) {
      pinned[key] = holders.subtracting(replaced).union([ref.id])
    }
    var target = Target(
      ref: ref, app: app,
      root: Self.rootSurface(
        pid: Int(pid), processStart: String(start), windowId: window.windowId,
        title: window.title, frame: window.frame))
    target.toolkit = toolkit
    target.knownWindows = NativeSurfaceProbe.windowIds(of: pid)
    targets[ref.id] = target
    return ref
  }

  // MARK: Shared

  /// The process and root window of a current ref: minted by this generation, recorded here,
  /// and its process still the one it named (a relaunched app reuses no ref).
  func window(of ref: TargetRefWire) throws(ComputerFailure) -> (pid: Int, windowId: Int) {
    guard ref.engineGeneration == generation, let target = targets[ref.id], target.ref == ref,
      let native = ref.native, let windowId = native.windowId
    else { throw Self.changed }
    guard
      NativeTargetProbe.processStart(pid: pid_t(native.pid)).map(String.init)
        == native.processStart
    else {
      targets[ref.id] = nil
      throw ComputerFailure(.targetChanged, "The target app quit or restarted; list targets again.")
    }
    return (native.pid, windowId)
  }

  /// Where the root surface of `ref` is read.
  func rootRead(_ ref: TargetRefWire) throws(ComputerFailure) -> NativeSurfaceRead {
    let (pid, windowId) = try window(of: ref)
    return NativeSurfaceRead(
      surfaceRefId: nil, pid: pid, windowId: windowId, root: .window, cropFrame: nil)
  }

  /// Where the latest observation was read, the root before any.
  func observedRead(_ ref: TargetRefWire) throws(ComputerFailure) -> NativeSurfaceRead {
    if let observed = targets[ref.id]?.observed { return observed }
    return try rootRead(ref)
  }

  /// A fresh snapshot of `surface` (by default the surface of the latest observation, or the
  /// root); it becomes that window's newest snapshot.
  func freshSnapshot(
    _ ref: TargetRefWire, surface: NativeSurfaceRead? = nil, operation: String? = nil
  ) async throws(ComputerFailure) -> DriverSnapshotResult {
    let place: NativeSurfaceRead
    if let surface { place = surface } else { place = try observedRead(ref) }
    return try await snapshot(place, operation: operation)
  }

  /// Refuses while the Mac is locked or its session is not on the console (D-O1.2): macOS then
  /// stubs every background app's windows in accessibility and drops posted input, so a read
  /// would describe the stub, not the app, and input would go nowhere.
  static func requireUnlockedSession() throws(ComputerFailure) {
    let session = CGSessionCopyCurrentDictionary() as? [String: Any]
    let locked = session?["CGSSessionScreenIsLocked"] as? Bool == true
    let onConsole = session?[kCGSessionOnConsoleKey as String] as? Bool ?? (session != nil)
    guard locked || !onConsole else { return }
    throw .noBackgroundRoute(
      .screenLocked,
      "The screen is locked; app windows can't be read or operated until it is unlocked.")
  }

  /// Refuses while Atd or its driver lacks the Accessibility grant, without prompting: prompts
  /// belong to the coordinator's attended path and to Settings.
  func requireAccessibility() throws(ComputerFailure) {
    guard AXIsProcessTrusted(), capabilities.contains(DriverCapabilityName.accessibility) else {
      throw ComputerFailure(
        .needsPermission,
        "Atd needs Accessibility permission (System Settings > Privacy & Security) to act in apps."
      )
    }
  }

  static let changed = ComputerFailure(
    .targetChanged, "The target ref is not current on this host; list targets again.")
}
