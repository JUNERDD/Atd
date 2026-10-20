/// The action's visual feedback, independent of its progress phase. A dispatch is not always
/// a click, and an input finishing without verification must not become a success animation.
public enum PointerAction: Equatable, Sendable {
  case click
  case fill
  case type
  case clear
  case scroll(ComputerStepWire.ScrollDirection)
  case other

  public init(_ step: ComputerStepWire) {
    switch step {
    case .click, .press: self = .click
    case .fill, .setValue: self = .fill
    case .type: self = .type
    case .clear: self = .clear
    case .scroll(_, let direction, _): self = .scroll(direction)
    default: self = .other
    }
  }

  public var isTextInput: Bool {
    switch self {
    case .fill, .type, .clear: true
    case .click, .scroll, .other: false
    }
  }
}
