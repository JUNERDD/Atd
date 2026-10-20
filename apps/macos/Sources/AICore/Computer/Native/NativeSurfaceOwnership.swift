import CoreGraphics
import Foundation

/// What accessibility and the window server say about a native target's app right now, as the
/// shell reads it itself (plan §2.2). Only relations the system states count: a sheet is a child
/// of its window, a modal dialog says it is modal, a service panel's window lies exactly where
/// the app's own sheet or dialog is and belongs to the system's panel service.
public struct NativeSurfaceFacts: Equatable, Sendable {
  /// One accessibility element: a window, or a sheet, popover or menu.
  public struct Element: Equatable, Sendable {
    public let role: String
    public let subrole: String?
    public let identifier: String?
    public let title: String?
    /// Quartz global points.
    public let frame: CGRect?
    /// `AXModal`.
    public let modal: Bool

    public init(
      role: String, subrole: String? = nil, identifier: String? = nil, title: String? = nil,
      frame: CGRect? = nil, modal: Bool = false
    ) {
      self.role = role
      self.subrole = subrole
      self.identifier = identifier
      self.title = title
      self.frame = frame
      self.modal = modal
    }
  }

  /// A window of the app, with its window-server id when its frame matched one.
  public struct Window: Equatable, Sendable {
    public let windowId: Int?
    public let element: Element
    /// Its direct sheet and popover children.
    public let children: [Element]

    public init(windowId: Int?, element: Element, children: [Element] = []) {
      self.windowId = windowId
      self.element = element
      self.children = children
    }
  }

  /// An on-screen window of another process that may host a panel for the app.
  public struct ForeignWindow: Equatable, Sendable {
    public let windowId: Int
    public let pid: Int
    public let processStart: String
    public let frame: CGRect
    /// Whether the process is the system's open and save panel service.
    public let isPanelService: Bool

    public init(
      windowId: Int, pid: Int, processStart: String, frame: CGRect, isPanelService: Bool
    ) {
      self.windowId = windowId
      self.pid = pid
      self.processStart = processStart
      self.frame = frame
      self.isPanelService = isPanelService
    }
  }

  public let pid: Int
  public let processStart: String
  public let windows: [Window]
  /// Menus open at the app's top level (context and pop-up menus).
  public let menus: [Element]
  public let foreign: [ForeignWindow]

  public init(
    pid: Int, processStart: String, windows: [Window], menus: [Element] = [],
    foreign: [ForeignWindow] = []
  ) {
    self.pid = pid
    self.processStart = processStart
    self.windows = windows
    self.menus = menus
    self.foreign = foreign
  }
}

/// Which surfaces of an app belong to a target whose root is window `rootWindowId`, and why
/// (plan §2.2, §4.2). The root and what the system relates to it count (its sheets and popovers,
/// the service panels drawn on them), every other top-level window of the application target's
/// own process (an `ownedWindow` the model can switch to, so resolving never asks the person to
/// choose a window), and what appeared after the host acted on the target (a menu, a new window,
/// recorded as `openedByAction`). A modal dialog of the app is always the target's.
public enum NativeSurfaceOwnership {
  /// One surface the facts prove, keyed so the same surface keeps its key across reads.
  public struct Candidate: Equatable, Sendable {
    public let key: String
    public let parentKey: String?
    public let kind: SurfaceRefWire.Kind
    public let basis: SurfaceRefWire.Basis
    public let modal: Bool
    public let title: String?
    public let pid: Int
    public let processStart: String
    /// The surface's own window, nil for a sheet, popover or menu inside another.
    public let windowId: Int?
    /// The process and window whose driver read holds the surface's elements and pixels.
    public let readPid: Int
    public let readWindowId: Int
    /// Quartz global points.
    public let frame: CGRect?
    /// The accessibility role at the top of the surface's elements in that read.
    public let role: String

    public init(
      key: String, parentKey: String?, kind: SurfaceRefWire.Kind, basis: SurfaceRefWire.Basis,
      modal: Bool, title: String?, pid: Int, processStart: String, windowId: Int?, readPid: Int,
      readWindowId: Int, frame: CGRect?, role: String
    ) {
      self.key = key
      self.parentKey = parentKey
      self.kind = kind
      self.basis = basis
      self.modal = modal
      self.title = title
      self.pid = pid
      self.processStart = processStart
      self.windowId = windowId
      self.readPid = readPid
      self.readWindowId = readWindowId
      self.frame = frame
      self.role = role
    }

    /// What must stay the same for the surface to be the one listed before.
    public var signature: String {
      let size = frame.map { "\(Int($0.width.rounded()))x\(Int($0.height.rounded()))" } ?? "-"
      return "\(kind.rawValue)|\(pid)|\(windowId ?? -1)|\(title ?? "")|\(size)"
    }
  }

  /// How close two frames from different sources must be to name the same window.
  static let tolerance: CGFloat = 2

  /// The root first, then each surface after its parent. `acted` says the host acted on the
  /// target since it last listed the surfaces, and `opened` are the window ids that appeared
  /// since; a window among them that is not a modal dialog is recorded as opened by the action.
  public static func candidates(
    _ facts: NativeSurfaceFacts, rootWindowId: Int, acted: Bool = false, opened: Set<Int> = []
  ) -> [Candidate] {
    guard let root = facts.windows.first(where: { $0.windowId == rootWindowId }) else {
      return []
    }
    let rootKey = "w\(rootWindowId)"
    var found = [
      windowSurface(root.element, key: rootKey, parent: nil, windowId: rootWindowId, facts, .root)
    ]
    found += children(of: root, key: rootKey, readWindowId: rootWindowId, facts)
    for window in facts.windows {
      guard let id = window.windowId, id != rootWindowId else { continue }
      let basis: SurfaceRefWire.Basis =
        acted && opened.contains(id) && !isModalDialog(window.element)
        ? .openedByAction : .ownedWindow
      let key = "w\(id)"
      found.append(
        windowSurface(window.element, key: key, parent: rootKey, windowId: id, facts, basis))
      found += children(of: window, key: key, readWindowId: id, facts)
    }
    for (index, menu) in facts.menus.enumerated() where acted {
      found.append(
        attached(
          menu, key: "\(rootKey)/menu\(index)", parent: rootKey, kind: .menu,
          basis: .openedByAction, readWindowId: rootWindowId, facts))
    }
    return found.map { servicePanel($0, facts) ?? $0 }
  }

  /// A modal dialog of the app: it blocks the app until it closes, so it is the target's.
  static func isModalDialog(_ element: NativeSurfaceFacts.Element) -> Bool {
    element.modal && ["AXDialog", "AXSystemDialog"].contains(element.subrole ?? "")
  }

  private static func children(
    of window: NativeSurfaceFacts.Window, key: String, readWindowId: Int,
    _ facts: NativeSurfaceFacts
  ) -> [Candidate] {
    window.children.enumerated().compactMap { index, child in
      switch child.role {
      case "AXSheet":
        attached(
          child, key: "\(key)/sheet\(index)", parent: key, kind: .sheet,
          basis: .attachedSheet, readWindowId: readWindowId, facts)
      case "AXPopover":
        attached(
          child, key: "\(key)/popover\(index)", parent: key, kind: .popover,
          basis: .attachedSheet, readWindowId: readWindowId, facts)
      default: nil
      }
    }
  }

  private static func windowSurface(
    _ element: NativeSurfaceFacts.Element, key: String, parent: String?, windowId: Int,
    _ facts: NativeSurfaceFacts, _ basis: SurfaceRefWire.Basis
  ) -> Candidate {
    let kind: SurfaceRefWire.Kind =
      switch element.subrole {
      case "AXDialog", "AXSystemDialog": .dialog
      case "AXFloatingWindow", "AXSystemFloatingWindow": .panel
      default: .window
      }
    return Candidate(
      key: key, parentKey: parent, kind: kind, basis: basis,
      modal: basis != .root && element.modal, title: element.title, pid: facts.pid,
      processStart: facts.processStart, windowId: windowId, readPid: facts.pid,
      readWindowId: windowId, frame: element.frame, role: element.role)
  }

  /// A surface inside another's window: a sheet (which blocks its window until it closes), a
  /// popover, or a menu. `attachedSheet` covers every surface accessibility attaches as a child.
  private static func attached(
    _ element: NativeSurfaceFacts.Element, key: String, parent: String,
    kind: SurfaceRefWire.Kind, basis: SurfaceRefWire.Basis, readWindowId: Int,
    _ facts: NativeSurfaceFacts
  ) -> Candidate {
    Candidate(
      key: key, parentKey: parent, kind: kind, basis: basis, modal: kind == .sheet,
      title: element.title, pid: facts.pid, processStart: facts.processStart,
      windowId: nil, readPid: facts.pid, readWindowId: readWindowId, frame: element.frame,
      role: element.role)
  }

  /// A sheet or dialog of the app that the panel service draws: exactly one of the service's
  /// windows lies on it. The surface is then that window, read in the service's process.
  private static func servicePanel(_ candidate: Candidate, _ facts: NativeSurfaceFacts)
    -> Candidate?
  {
    guard candidate.kind == .sheet || candidate.kind == .dialog, let frame = candidate.frame
    else { return nil }
    let matches = facts.foreign.filter { $0.isPanelService && same($0.frame, frame) }
    guard matches.count == 1, let panel = matches.first else { return nil }
    return Candidate(
      key: candidate.key, parentKey: candidate.parentKey, kind: .panel, basis: .servicePanel,
      modal: true, title: candidate.title, pid: panel.pid, processStart: panel.processStart,
      windowId: panel.windowId, readPid: panel.pid, readWindowId: panel.windowId, frame: frame,
      role: "AXWindow")
  }

  /// Whether two frames from different sources name the same window or element.
  public static func same(_ lhs: CGRect, _ rhs: CGRect) -> Bool {
    abs(lhs.minX - rhs.minX) <= tolerance && abs(lhs.minY - rhs.minY) <= tolerance
      && abs(lhs.width - rhs.width) <= tolerance && abs(lhs.height - rhs.height) <= tolerance
  }
}
