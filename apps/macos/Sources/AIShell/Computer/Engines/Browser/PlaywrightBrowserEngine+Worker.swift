import AICore
import Foundation
import MCP

/// Talking to the profile's worker, and what the engine keeps around those calls: the target's
/// surfaces (listed again from `list_pages`), the run's download directory and the downloads a
/// call reports, and the profile `computer.hello` publishes.
extension PlaywrightBrowserEngine {
  /// A popup that closed, left the binding's sites or was never listed.
  static let surfaceGone = ComputerFailure(
    .targetChanged, "The popup closed or left the target's sites; list targets again.")

  /// Calls the profile's worker (``BrowserWorkerPool/invoke(_:_:_:timeout:writes:pinned:)``).
  func call(
    _ instance: ManagedChromeInstance, _ tool: String, _ arguments: [String: Value],
    timeout: Duration, writes: Bool, pinned: Int? = nil
  ) async throws(ComputerFailure) -> (reply: BrowserWorkerReply, generation: Int) {
    try await workers.invoke(
      instance, tool, arguments, timeout: timeout, writes: writes, pinned: pinned)
  }

  /// A successful reply, or its failure (``BrowserWorkerReply/checked(_:)``).
  func checked(_ reply: BrowserWorkerReply, _ tool: String) throws(ComputerFailure)
    -> BrowserWorkerReply
  {
    try reply.checked(tool)
  }

  /// The binding's sites as the worker takes them (`allowedOrigins`): frames outside them are
  /// neither listed nor driven.
  static func origins(_ binding: TargetBindingWire.Browser) -> Value {
    .array(
      binding.allowedOrigins.compactMap(BrowserOrigins.normalized).prefix(32).map(Value.string))
  }

  // MARK: Surfaces

  /// The page targets of the profile's browser, with the page that opened each.
  func listPages(_ instance: ManagedChromeInstance) async throws(ComputerFailure)
    -> [BrowserWorkerReply.Page]
  {
    let (reply, _) = try await call(
      instance, "list_pages", [:], timeout: .seconds(10), writes: false)
    return try checked(reply, "list_pages").pages ?? []
  }

  /// Lists the target's surfaces again; the bound page being gone ends the ref.
  func refreshSurfaces(
    _ ref: TargetRefWire, _ instance: ManagedChromeInstance, _ binding: TargetBindingWire.Browser
  ) async throws(ComputerFailure) -> BrowserSurfaceSet {
    let pages = try await listPages(instance)
    guard var set = surfaces[ref.id] else {
      throw ComputerFailure(
        .targetChanged, "The browser target is not current; list targets again.")
    }
    guard pages.contains(where: { $0.pageId == set.boundPageId }) else {
      throw ComputerFailure(.targetChanged, "The target's page closed; list targets again.")
    }
    set.reconcile(pages, origins: binding.allowedOrigins)
    surfaces[ref.id] = set
    return set
  }

  /// The page an action on surface `id` writes to: the bound page for the root, without a
  /// listing; a popup only while it is still admitted.
  func surfacePage(
    _ ref: TargetRefWire, _ id: String?, _ instance: ManagedChromeInstance,
    _ binding: TargetBindingWire.Browser
  ) async throws(ComputerFailure) -> String {
    guard let bound = surfaces[ref.id] else { throw Self.surfaceGone }
    guard let id, id != bound.rootId else { return bound.boundPageId }
    guard let pageId = try await refreshSurfaces(ref, instance, binding).pageId(of: id) else {
      throw Self.surfaceGone
    }
    return pageId
  }

  // MARK: Downloads

  /// `<dataDir>/computer/downloads/<runId>/`, created owner-only before the first call that may
  /// download for the run; the worker saves the run's downloads there and nowhere else.
  func downloadDirectory(runId: String) throws(ComputerFailure) -> URL {
    guard let directory = BrowserFileScope.runDirectory(downloadsRoot, runId: runId) else {
      throw ComputerFailure(.engineFailed, "The run id cannot name a download directory.")
    }
    do {
      try FileManager.default.createDirectory(
        at: directory, withIntermediateDirectories: true,
        attributes: [.posixPermissions: 0o700])
    } catch {
      throw ComputerFailure(
        .engineFailed, "The run's download directory could not be created; nothing was sent.")
    }
    return directory
  }

  /// The downloads a reply reports that really are files of `directory`.
  static func downloads(_ reply: BrowserWorkerReply, in directory: URL) -> [ComputerDownloadWire] {
    (reply.downloads ?? []).compactMap { BrowserFileScope.download($0, in: directory) }
  }

  // MARK: Profile

  /// What each target supports: every step in the background, elements named by ref or
  /// semantically (never by image point), verified only where flows were qualified.
  static var targetCapabilities: [TargetCapabilityWire] {
    actions.map { kind in
      TargetCapabilityWire(
        action: kind, locate: kind == .navigate || kind == .wait ? [] : [.element, .semantic],
        delivery: [.background], verified: verifiedActions.contains(kind),
        routes: route(of: kind).map { [$0] })
    }
  }

  /// The channel a step's input takes: Chrome's DevTools commands for navigation, text, clicks,
  /// keys and files (`cdp`), or script run in the page for a scroll or a choice in a select
  /// (`script`). A wait sends nothing.
  static func route(of kind: ComputerStepKind) -> ActionResultWire.Route? {
    switch kind {
    case .navigate, .fill, .clear, .press, .key, .upload: .cdp
    case .scroll, .select: .script
    default: nil
    }
  }

  /// What `computer.hello` publishes: qualified while Chrome and the worker are installed, for
  /// the background. A browser that does not run is started by the access operation, in the
  /// background (``ManagedChromes/openFirstPage(for:running:)``), not by the engine.
  static func makeProfile(chromeVersion: String?, workerReady: Bool) -> CapabilityProfileWire {
    let system = ProcessInfo.processInfo.operatingSystemVersion
    let evidence: String =
      if let chromeVersion, workerReady {
        "playwright-core \(playwrightVersion) over CDP on a managed Google Chrome "
          + "\(chromeVersion) profile, in the background: "
          + "navigate, fill, press, scroll and wait at parity with the earlier engine; clear, "
          + "key, select and upload unverified. Clicks are trusted input. Popups of the page on "
          + "its sites are surfaces; downloads are saved for the run only. A website's page opens "
          + "in a background tab, or a parked background window when the browser has none."
      } else if chromeVersion == nil {
        "Google Chrome is not installed."
      } else {
        "The browser worker is not installed."
      }
    #if arch(arm64)
      let arch = CapabilityProfileWire.Arch.arm64
    #else
      let arch = CapabilityProfileWire.Arch.x8664
    #endif
    return CapabilityProfileWire(
      engine: .playwright, engineVersion: playwrightVersion,
      os: "macOS \(system.majorVersion).\(system.minorVersion).\(system.patchVersion)", arch: arch,
      targetKinds: [.browser], actions: actions,
      effects: [.read, .navigate, .input, .click, .invoke, .submit], delivery: [.background],
      affectsSystemInput: false,
      qualification: chromeVersion != nil && workerReady ? .qualified : .unqualified,
      evidence: evidence)
  }
}
