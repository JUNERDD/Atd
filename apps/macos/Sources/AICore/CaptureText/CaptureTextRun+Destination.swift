import Foundation

extension CaptureTextRun {
  /// Where the run's answer lands, by its output (decision D2): `replaceSelection` replaces each
  /// paragraph on the image, `insertAfterSelection` numbers steps, `annotate` draws steps and
  /// highlighter marks; every other output stays on the result card.
  public enum Destination: Equatable, Sendable {
    case replace, steps, marks, card

    public init(_ output: CommandOutputAction) {
      switch output {
      case .replaceSelection: self = .replace
      case .insertAfterSelection: self = .steps
      case .annotate: self = .marks
      case .panel, .card, .insertAtCursor, .copy: self = .card
      }
    }

    /// Whether `tool` draws on the image here.
    public func draws(_ tool: Item.Tool) -> Bool {
      switch tool {
      case .replace: self == .replace
      case .step: self == .steps || self == .marks
      case .highlight, .box, .ellipse, .arrow, .spotlight, .mosaic: self == .marks
      }
    }
  }

  public var destination: Destination { Destination(output) }
}
