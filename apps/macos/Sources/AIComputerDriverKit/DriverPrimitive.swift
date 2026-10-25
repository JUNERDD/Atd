import Foundation

/// A target window, by the process id and the WindowServer window number the host already knows
/// from the snapshot. Window numbers fit in `UInt32`; the wire uses `Int` and the driver narrows.
public struct DriverTarget: Codable, Equatable, Sendable {
  public var pid: Int
  public var windowId: Int

  public init(pid: Int, windowId: Int) {
    self.pid = pid
    self.windowId = windowId
  }
}

/// The semantic AX action to perform on an element. `showAlternateUI` reveals hover-only controls
/// without a pointer; `showMenu`/`raise` are deliberately absent — they are visible-interface
/// actions the background path must not take (plan I3).
public enum DriverAXActionKind: String, Codable, Equatable, Sendable {
  case press, pick, confirm, increment, decrement, showAlternateUI
}

/// A scroll gesture expressed semantically, so it needs no pointer.
public enum DriverScrollKind: String, Codable, Equatable, Sendable {
  case toVisible, pageUp, pageDown, pageLeft, pageRight
}

/// An inclusive text range for `axInsertText` replacement, in UTF-16 units (AX's unit).
public struct DriverTextRange: Codable, Equatable, Sendable {
  public var location: Int
  public var length: Int

  public init(location: Int, length: Int) {
    self.location = location
    self.length = length
  }
}

/// One background primitive. The host picks the primitive and the routes it allows (`routeAllow`
/// on the request); the driver never upgrades past what it is handed. Element-addressed
/// primitives carry a `<snapshotId>.e<index>` token; coordinate-addressed ones carry global
/// top-left screen points the host computed from the observation capture.
public enum DriverPrimitive: Equatable, Sendable {
  case axAction(element: String, action: DriverAXActionKind)
  case axSetValue(element: String, value: String)
  case axInsertText(element: String, text: String, replaceRange: DriverTextRange?)
  case axFocus(element: String)
  case axMenu(path: [String])
  case axScroll(element: String?, kind: DriverScrollKind)
  case pointer(point: DriverPoint, clickCount: Int)
  case scroll(point: DriverPoint, deltaX: Double, deltaY: Double)
  case keys(chord: String)
  case text(text: String)
  case drag(from: DriverPoint, to: DriverPoint)
}

extension DriverPrimitive: Codable {
  private enum CodingKeys: String, CodingKey {
    case op, element, action, value, text, replaceRange, path, kind, point, from, to
    case clickCount, deltaX, deltaY, chord
  }

  /// The discriminator written to `op`. Kept identical to the case names so the spec reads 1:1.
  private enum Op: String, Codable {
    case axAction, axSetValue, axInsertText, axFocus, axMenu, axScroll
    case pointer, scroll, keys, text, drag
  }

  public func encode(to encoder: any Encoder) throws {
    var c = encoder.container(keyedBy: CodingKeys.self)
    switch self {
    case .axAction(let element, let action):
      try c.encode(Op.axAction, forKey: .op)
      try c.encode(element, forKey: .element)
      try c.encode(action, forKey: .action)
    case .axSetValue(let element, let value):
      try c.encode(Op.axSetValue, forKey: .op)
      try c.encode(element, forKey: .element)
      try c.encode(value, forKey: .value)
    case .axInsertText(let element, let text, let replaceRange):
      try c.encode(Op.axInsertText, forKey: .op)
      try c.encode(element, forKey: .element)
      try c.encode(text, forKey: .text)
      try c.encodeIfPresent(replaceRange, forKey: .replaceRange)
    case .axFocus(let element):
      try c.encode(Op.axFocus, forKey: .op)
      try c.encode(element, forKey: .element)
    case .axMenu(let path):
      try c.encode(Op.axMenu, forKey: .op)
      try c.encode(path, forKey: .path)
    case .axScroll(let element, let kind):
      try c.encode(Op.axScroll, forKey: .op)
      try c.encodeIfPresent(element, forKey: .element)
      try c.encode(kind, forKey: .kind)
    case .pointer(let point, let clickCount):
      try c.encode(Op.pointer, forKey: .op)
      try c.encode(point, forKey: .point)
      try c.encode(clickCount, forKey: .clickCount)
    case .scroll(let point, let deltaX, let deltaY):
      try c.encode(Op.scroll, forKey: .op)
      try c.encode(point, forKey: .point)
      try c.encode(deltaX, forKey: .deltaX)
      try c.encode(deltaY, forKey: .deltaY)
    case .keys(let chord):
      try c.encode(Op.keys, forKey: .op)
      try c.encode(chord, forKey: .chord)
    case .text(let text):
      try c.encode(Op.text, forKey: .op)
      try c.encode(text, forKey: .text)
    case .drag(let from, let to):
      try c.encode(Op.drag, forKey: .op)
      try c.encode(from, forKey: .from)
      try c.encode(to, forKey: .to)
    }
  }

  public init(from decoder: any Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    switch try c.decode(Op.self, forKey: .op) {
    case .axAction:
      self = .axAction(
        element: try c.decode(String.self, forKey: .element),
        action: try c.decode(DriverAXActionKind.self, forKey: .action))
    case .axSetValue:
      self = .axSetValue(
        element: try c.decode(String.self, forKey: .element),
        value: try c.decode(String.self, forKey: .value))
    case .axInsertText:
      self = .axInsertText(
        element: try c.decode(String.self, forKey: .element),
        text: try c.decode(String.self, forKey: .text),
        replaceRange: try c.decodeIfPresent(DriverTextRange.self, forKey: .replaceRange))
    case .axFocus:
      self = .axFocus(element: try c.decode(String.self, forKey: .element))
    case .axMenu:
      self = .axMenu(path: try c.decode([String].self, forKey: .path))
    case .axScroll:
      self = .axScroll(
        element: try c.decodeIfPresent(String.self, forKey: .element),
        kind: try c.decode(DriverScrollKind.self, forKey: .kind))
    case .pointer:
      self = .pointer(
        point: try c.decode(DriverPoint.self, forKey: .point),
        clickCount: try c.decode(Int.self, forKey: .clickCount))
    case .scroll:
      self = .scroll(
        point: try c.decode(DriverPoint.self, forKey: .point),
        deltaX: try c.decode(Double.self, forKey: .deltaX),
        deltaY: try c.decode(Double.self, forKey: .deltaY))
    case .keys:
      self = .keys(chord: try c.decode(String.self, forKey: .chord))
    case .text:
      self = .text(text: try c.decode(String.self, forKey: .text))
    case .drag:
      self = .drag(
        from: try c.decode(DriverPoint.self, forKey: .from),
        to: try c.decode(DriverPoint.self, forKey: .to))
    }
  }
}
