import Foundation

/// The live surfaces of one native target, as the host lists them (`SurfaceRefSchema`). Each
/// surface keeps its id while every read proves it is still the same one; a surface that closed,
/// was rebuilt (another title, size or window in its place) or lost its owner goes, its children
/// with it, and anything it reappears as gets a new id with the next generation. The root is
/// always first and never changes: a different root window is a different target ref.
public struct NativeSurfaceSet: Equatable, Sendable {
  public struct Entry: Equatable, Sendable {
    public let id: String
    public let generation: Int
    public let candidate: NativeSurfaceOwnership.Candidate
    public let parentId: String?
  }

  public let targetRefId: String
  public private(set) var entries: [Entry]
  /// Mints of each key so far, so a rebuilt surface's generation grows.
  private var mints: [String: Int] = [:]
  private var serial = 0

  /// The set holding only the root, as resolving the target lists it.
  public init(targetRefId: String, root: NativeSurfaceOwnership.Candidate) {
    self.targetRefId = targetRefId
    entries = [Entry(id: "\(targetRefId).s0", generation: 1, candidate: root, parentId: nil)]
    mints[root.key] = 1
  }

  public var root: Entry { entries[0] }

  /// The surface `id` names; nil names the root. Nil when no live surface has that id.
  public func entry(_ id: String?) -> Entry? {
    guard let id else { return root }
    return entries.first { $0.id == id }
  }

  /// Takes a new listing. Returns the ids that are gone (closed, rebuilt or orphaned), or nil
  /// when the root itself is missing or changed, which ends the target ref.
  @discardableResult
  public mutating func reconcile(_ candidates: [NativeSurfaceOwnership.Candidate]) -> [String]? {
    guard let rootCandidate = candidates.first, rootCandidate.key == root.candidate.key,
      rootCandidate.pid == root.candidate.pid, rootCandidate.windowId == root.candidate.windowId
    else { return nil }
    let previous = entries
    var next = [
      Entry(id: root.id, generation: root.generation, candidate: rootCandidate, parentId: nil)
    ]
    for candidate in candidates.dropFirst() {
      // A surface whose parent went this round goes too.
      guard let parent = next.first(where: { $0.candidate.key == candidate.parentKey }) else {
        continue
      }
      if let kept = previous.first(where: { $0.candidate.key == candidate.key }),
        kept.candidate.signature == candidate.signature, kept.parentId == parent.id
      {
        next.append(
          Entry(
            id: kept.id, generation: kept.generation, candidate: candidate, parentId: parent.id))
        continue
      }
      let generation = (mints[candidate.key] ?? 0) + 1
      mints[candidate.key] = generation
      serial += 1
      next.append(
        Entry(
          id: "\(targetRefId).s\(serial)", generation: generation, candidate: candidate,
          parentId: parent.id))
    }
    entries = next
    let live = Set(next.map(\.id))
    return previous.map(\.id).filter { !live.contains($0) }
  }

  /// An open modal surface below `id` (a sheet on it, a modal dialog of its app), which blocks
  /// writes to `id` until it closes; nil when nothing blocks it.
  public func modalBlocker(of id: String?) -> Entry? {
    guard let surface = entry(id) else { return nil }
    var frontier = [surface.id]
    while let current = frontier.popLast() {
      for child in entries where child.parentId == current {
        if child.candidate.modal { return child }
        frontier.append(child.id)
      }
    }
    return nil
  }

  /// The surfaces as an observation lists them, at most ``ComputerWireLimits/maxSurfaces``.
  public var wire: [SurfaceRefWire] {
    entries.prefix(ComputerWireLimits.maxSurfaces).map { entry in
      let candidate = entry.candidate
      return SurfaceRefWire(
        id: entry.id, targetRefId: targetRefId, parentId: entry.parentId, kind: candidate.kind,
        title: candidate.title, pid: candidate.pid, processStart: candidate.processStart,
        windowId: candidate.windowId, generation: entry.generation, basis: candidate.basis,
        modal: candidate.modal)
    }
  }
}
