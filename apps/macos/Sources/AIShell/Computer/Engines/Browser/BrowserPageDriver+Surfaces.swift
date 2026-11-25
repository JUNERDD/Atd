import AICore
import Foundation
import MCP

/// Talking to the browser's worker, and what the driver keeps around those calls: the target's
/// surfaces (listed again from `list_pages`), and the run's download directory and the downloads a
/// call reports.
extension BrowserPageDriver {
  /// A popup that closed, left the binding's sites or was never listed.
  static let surfaceGone = ComputerFailure(
    .targetChanged, "The popup closed or left the target's sites; list targets again.")

  /// Calls the browser's worker (``BrowserWorkerPool/invoke(_:_:_:timeout:writes:pinned:)``).
  func call(
    _ endpoint: any BrowserWorkerEndpoint, _ tool: String, _ arguments: [String: Value],
    timeout: Duration, writes: Bool, pinned: Int? = nil
  ) async throws(ComputerFailure) -> (reply: BrowserWorkerReply, generation: Int) {
    try await workers.invoke(
      endpoint, tool, arguments, timeout: timeout, writes: writes, pinned: pinned)
  }

  /// The binding's sites as the worker takes them (`allowedOrigins`): frames outside them are
  /// neither listed nor driven.
  static func origins(_ binding: TargetBindingWire.Browser) -> Value {
    .array(
      binding.allowedOrigins.compactMap(BrowserOrigins.normalized).prefix(32).map(Value.string))
  }

  // MARK: Surfaces

  /// The page targets the browser's worker drives, with the page that opened each.
  func listPages(_ endpoint: any BrowserWorkerEndpoint) async throws(ComputerFailure)
    -> [BrowserWorkerReply.Page]
  {
    let (reply, _) = try await call(
      endpoint, "list_pages", [:], timeout: .seconds(10), writes: false)
    return try reply.checked("list_pages").pages ?? []
  }

  /// Lists the target's surfaces again; the bound page being gone ends the ref.
  func refreshSurfaces(_ ref: TargetRefWire, _ target: Target) async throws(ComputerFailure)
    -> BrowserSurfaceSet
  {
    let pages = try await listPages(target.endpoint)
    guard var set = surfaces[ref.id] else {
      throw ComputerFailure(
        .targetChanged, "The browser target is not current; list targets again.")
    }
    guard pages.contains(where: { $0.pageId == set.boundPageId }) else {
      throw ComputerFailure(.targetChanged, "The target's page closed; list targets again.")
    }
    set.reconcile(pages, origins: target.binding.allowedOrigins)
    surfaces[ref.id] = set
    return set
  }

  /// The page an action on surface `id` writes to: the bound page for the root, without a
  /// listing; a popup only while it is still admitted.
  func surfacePage(_ ref: TargetRefWire, _ id: String?, _ target: Target)
    async throws(ComputerFailure) -> String
  {
    guard let bound = surfaces[ref.id] else { throw Self.surfaceGone }
    guard let id, id != bound.rootId else { return bound.boundPageId }
    guard let pageId = try await refreshSurfaces(ref, target).pageId(of: id) else {
      throw Self.surfaceGone
    }
    return pageId
  }

  // MARK: Downloads

  /// `<dataDir>/computer/downloads/<runId>/`, created owner-only before the first call that may
  /// download for the run; the worker saves the run's downloads there and nowhere else. Nil where
  /// the driver has no download root.
  func downloadDirectory(runId: String) throws(ComputerFailure) -> URL? {
    guard let downloadsRoot else { return nil }
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
  static func downloads(_ reply: BrowserWorkerReply, in directory: URL?) -> [ComputerDownloadWire] {
    guard let directory else { return [] }
    return (reply.downloads ?? []).compactMap { BrowserFileScope.download($0, in: directory) }
  }
}
