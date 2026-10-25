import Foundation

/// The surfaces of one browser target (contract v1.3 B5): its bound page, which is the root, and
/// the popups whose opener chain reaches the bound page while they show one of the binding's
/// sites. A page whose opener the worker does not report, whose chain breaks at a page that is
/// gone, or that shows another site is never a surface. Each popup keeps its id while it stays
/// admitted; one that closed or left the sites goes, and if it comes back it gets a new id with
/// the next generation, so an older id never names it again.
public struct BrowserSurfaceSet: Equatable, Sendable {
  public struct Popup: Equatable, Sendable {
    public let id: String
    public let pageId: String
    public let generation: Int
    public let openerId: String
    public let title: String
  }

  public let targetRefId: String
  public let boundPageId: String
  public private(set) var rootTitle = ""
  public private(set) var popups: [Popup] = []
  /// Mints per page so far, so a popup admitted again gets a later generation.
  private var mints: [String: Int] = [:]
  private var serial = 0

  public init(targetRefId: String, boundPageId: String) {
    self.targetRefId = targetRefId
    self.boundPageId = boundPageId
  }

  /// The root surface's id; it never changes, as another bound page is another target ref.
  public var rootId: String { "\(targetRefId).s0" }

  /// The page surface `id` shows: the bound page for nil or the root's id, a listed popup's page,
  /// or nil when no listed surface has that id.
  public func pageId(of id: String?) -> String? {
    guard let id, id != rootId else { return boundPageId }
    return popups.first { $0.id == id }?.pageId
  }

  /// Takes a listing of the browser's pages. Returns the ids of the popups that went.
  @discardableResult
  public mutating func reconcile(_ pages: [BrowserWorkerReply.Page], origins: [String])
    -> [String]
  {
    let byId = Dictionary(pages.map { ($0.pageId, $0) }) { first, _ in first }
    rootTitle = byId[boundPageId]?.title ?? rootTitle
    var next: [Popup] = []
    for page in pages where next.count < ComputerWireLimits.maxSurfaces - 1 {
      guard page.pageId != boundPageId, let openerId = page.openerId,
        reachesBound(page, byId), BrowserOrigins.allows(page.url, origins: origins)
      else { continue }
      if let kept = popups.first(where: { $0.pageId == page.pageId }) {
        next.append(
          Popup(
            id: kept.id, pageId: page.pageId, generation: kept.generation, openerId: openerId,
            title: page.title))
        continue
      }
      let generation = (mints[page.pageId] ?? 0) + 1
      mints[page.pageId] = generation
      serial += 1
      next.append(
        Popup(
          id: "\(targetRefId).p\(serial)", pageId: page.pageId, generation: generation,
          openerId: openerId, title: page.title))
    }
    let live = Set(next.map(\.id))
    let gone = popups.map(\.id).filter { !live.contains($0) }
    popups = next
    return gone
  }

  /// The surfaces as an observation lists them; every one belongs to the managed browser's
  /// process (`pid`, `processStart`). A popup's parent is its opener's surface, else the root.
  public func wire(pid: Int, processStart: String) -> [SurfaceRefWire] {
    let byPage = Dictionary(popups.map { ($0.pageId, $0.id) }) { first, _ in first }
    let root = SurfaceRefWire(
      id: rootId, targetRefId: targetRefId, kind: .window,
      title: rootTitle.isEmpty ? nil : rootTitle, pid: pid, processStart: processStart,
      generation: 1, basis: .root, modal: false)
    return [root]
      + popups.map { popup in
        SurfaceRefWire(
          id: popup.id, targetRefId: targetRefId, parentId: byPage[popup.openerId] ?? rootId,
          kind: .window, title: popup.title.isEmpty ? nil : popup.title, pid: pid,
          processStart: processStart, generation: popup.generation, basis: .openedByAction,
          modal: false)
      }
  }

  /// Whether following openers from `page` reaches the bound page through pages still open.
  private func reachesBound(
    _ page: BrowserWorkerReply.Page, _ byId: [String: BrowserWorkerReply.Page]
  ) -> Bool {
    var seen: Set<String> = [page.pageId]
    var opener = page.openerId
    while let id = opener, seen.insert(id).inserted {
      if id == boundPageId { return true }
      opener = byId[id]?.openerId
    }
    return false
  }
}
