import AIComputerDriverKit
import Foundation

/// One observation of a native window as the atd engine keeps it: the driver snapshot it came
/// from and the elements it showed. Element refs are scoped to it (`<observationId>.e<index>`), so
/// a ref from another observation never resolves, and an element is found again in a newer
/// driver snapshot only when it is plainly the same element. The driver names the same element by
/// its token, `<snapshotId>.e<index>` (``token(of:)``), which only that window's newest snapshot
/// still resolves.
public struct NativeObservation: Equatable, Sendable {
  /// Roles whose value is free text the engine may set.
  public static let textInputRoles: Set<String> = [
    "AXTextArea", "AXTextField", "AXSearchField", "AXComboBox",
  ]
  /// Roles and subroles whose value is never shown or set.
  public static let secretRoles: Set<String> = ["AXSecureTextField"]

  public let id: String
  public let snapshotId: String
  /// The surface's own elements (the menu bar left out), in the driver's order.
  public let elements: [DriverElement]

  public init(id: String, snapshotId: String, elements: [DriverElement]) {
    self.id = id
    self.snapshotId = snapshotId
    self.elements = elements
  }

  /// Where a surface's elements start in a driver snapshot: the window itself, or the first
  /// element of `role` at `frame` (a sheet, popover or menu inside the snapshot's window).
  public enum Root: Equatable, Sendable {
    case window
    case element(role: String, frame: CGRect?)

    func starts(at element: DriverElement) -> Bool {
      switch self {
      case .window: return element.parentIndex == nil && element.role == "AXWindow"
      case .element(let role, let frame):
        guard element.role == role else { return false }
        guard let frame, let found = element.frame?.cgRect else { return true }
        return NativeSurfaceOwnership.same(found, frame)
      }
    }
  }

  /// The elements of `snapshot` an observation shows: the subtree at `root` without pure layout
  /// containers, at most ``ComputerWireLimits/maxElements``.
  public init(id: String, snapshot: DriverSnapshotResult, root: Root = .window) {
    var subtree: Set<Int> = []
    var kept: [DriverElement] = []
    for element in snapshot.elements {
      let inSurface: Bool
      if let parent = element.parentIndex, subtree.contains(parent) {
        inSurface = true
      } else {
        inSurface = subtree.isEmpty && root.starts(at: element)
      }
      guard inSurface else { continue }
      subtree.insert(element.index)
      let meaningful =
        subtree.count == 1 || !element.actions.isEmpty || element.label != nil
        || element.value != nil || Self.textInputRoles.contains(element.role)
      if meaningful, kept.count < ComputerWireLimits.maxElements { kept.append(element) }
    }
    self.init(id: id, snapshotId: snapshot.snapshotId, elements: kept)
  }

  /// The ref of `element` in this observation.
  public func ref(of element: DriverElement) -> String { "\(id).e\(element.index)" }

  /// The driver's token of `element` in this observation's snapshot.
  public func token(of element: DriverElement) -> String {
    Self.token(snapshotId: snapshotId, element)
  }

  /// The driver's token of `element` in the snapshot `snapshotId`.
  public static func token(snapshotId: String, _ element: DriverElement) -> String {
    "\(snapshotId).e\(element.index)"
  }

  /// Whether `element` holds a secret (a password field), whose value is never shown or set.
  public static func isSecret(_ element: DriverElement) -> Bool {
    secretRoles.contains(element.role) || element.subrole.map(secretRoles.contains) == true
  }

  /// The elements as the service sees them: values cut to 200 characters, secrets masked, and,
  /// with the observation's `capture`, each one's frame in that capture's pixels where it shows.
  public func wireElements(in capture: NativeCapture? = nil) -> [ObservationElementWire] {
    elements.map { element in
      let secret = Self.isSecret(element)
      return ObservationElementWire(
        ref: ref(of: element), role: element.role, name: element.label,
        value: secret ? (element.value == nil ? nil : "••••") : element.value,
        enabled: element.enabled ?? true, focused: element.focused,
        frame: element.frame.flatMap { capture?.pixelRect(of: $0.cgRect) }
          .map(ComputerRectWire.init))
    }
  }

  /// The element `locator` names: a ref of this observation, or the one element matching every
  /// field of a semantic description.
  public func resolve(_ locator: ComputerLocatorWire) -> Result<DriverElement, LookupFailure> {
    switch locator {
    case .ref(let ref):
      let prefix = id + ".e"
      guard ref.hasPrefix(prefix), let index = Int(ref.dropFirst(prefix.count)) else {
        return .failure(.stale)
      }
      guard let element = elements.first(where: { $0.index == index }) else {
        return .failure(.notFound)
      }
      return .success(element)
    case .semantic(let semantic):
      let matches = elements.filter { Self.matches($0, semantic) }
      switch matches.count {
      case 0: return .failure(.notFound)
      case 1: return .success(matches[0])
      default: return .failure(.ambiguous(matches.count))
      }
    }
  }

  /// The parent of `element` in this observation, nil for its root or a parent left out.
  public func parent(of element: DriverElement) -> DriverElement? {
    guard let parent = element.parentIndex else { return nil }
    return elements.first { $0.index == parent }
  }

  /// `element` in a newer snapshot of the same window: the element at the same index with the
  /// same role and, unless it is a text input (whose label is its changing content), the same
  /// label.
  public static func counterpart(of element: DriverElement, in snapshot: DriverSnapshotResult)
    -> DriverElement?
  {
    guard let candidate = snapshot.elements.first(where: { $0.index == element.index }),
      candidate.role == element.role,
      textInputRoles.contains(element.role) || candidate.label == element.label
    else { return nil }
    return candidate
  }

  /// Whether a read-back value is `text`. Accessibility reads of a text view may drop the
  /// text's final line breaks, so those alone never make the values differ.
  public static func valueMatches(_ value: String?, _ text: String) -> Bool {
    guard let value else { return false }
    return value == text || trimmingFinalNewlines(value) == trimmingFinalNewlines(text)
  }

  /// Every visible text of the elements (labels and values), for `textAppears` and `newText`.
  public static func texts(_ elements: [DriverElement]) -> [String] {
    elements.flatMap { element in
      isSecret(element) ? [] : [element.label, element.value].compactMap { $0 }
    }
  }

  public enum LookupFailure: Error, Equatable, Sendable {
    /// The ref belongs to another observation.
    case stale
    case notFound
    case ambiguous(Int)

    public var code: ComputerErrorCode {
      switch self {
      case .stale: .staleObservation
      case .notFound: .notFound
      case .ambiguous: .ambiguous
      }
    }

    public var message: String {
      switch self {
      case .stale: "The element ref is not from the target's current observation; observe again."
      case .notFound: "No element of the observation matches the locator."
      case .ambiguous(let count):
        "\(count) elements match the locator; name the element more precisely or use its ref."
      }
    }
  }

  private static func matches(_ element: DriverElement, _ semantic: ComputerLocatorWire.Semantic)
    -> Bool
  {
    // The driver reports no placeholders, so a locator that needs one matches nothing.
    if semantic.placeholder != nil { return false }
    if let role = semantic.role, normalizedRole(role) != normalizedRole(element.role) {
      return false
    }
    for name in [semantic.name, semantic.label].compactMap({ $0 })
    where !same(element.label, name) {
      return false
    }
    if let text = semantic.text {
      let haystacks = [element.label, element.value].compactMap { $0 }
      if isSecret(element) || !haystacks.contains(where: { $0.contains(text) }) { return false }
    }
    return true
  }

  /// `AXTextArea`, `textarea` and `TextArea` name one role.
  private static func normalizedRole(_ role: String) -> String {
    (role.hasPrefix("AX") ? String(role.dropFirst(2)) : role).lowercased()
  }

  private static func same(_ label: String?, _ name: String) -> Bool {
    guard let label else { return false }
    return label.trimmingCharacters(in: .whitespaces)
      .caseInsensitiveCompare(name.trimmingCharacters(in: .whitespaces)) == .orderedSame
  }

  private static func trimmingFinalNewlines(_ text: String) -> Substring {
    var text = Substring(text)
    while text.last?.isNewline == true { text.removeLast() }
    return text
  }
}

extension DriverRect {
  /// The rect in Quartz global points (top-left origin), as the host's geometry uses it.
  public var cgRect: CGRect { CGRect(x: x, y: y, width: width, height: height) }

  /// The centre point, where an event rung aims at an element.
  public var center: DriverPoint { DriverPoint(x: x + width / 2, y: y + height / 2) }
}
