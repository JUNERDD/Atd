import Foundation

/// How a step's locator names one element of an observation (D2). A `ref` must be one of the
/// observation's element refs. A semantic locator (recipes) matches the elements whose role
/// equals `role` when given and whose accessible name equals every given text field (`name`,
/// `label`, `placeholder`, `text`: the browser folds a field's label, placeholder or a button's
/// text into its accessible name), compared without case and with whitespace collapsed. Exactly
/// one match resolves; none is `notFound`, several are `ambiguous`. Nothing is guessed by
/// position or partial text, so a rebuilt neighbour can never be written instead.
public enum LocatorResolution: Equatable, Sendable {
  case found(ref: String)
  case notFound
  case ambiguous(count: Int)

  public static func resolve(
    _ locator: ComputerLocatorWire, in elements: [ObservationElementWire]
  ) -> LocatorResolution {
    switch locator {
    case .ref(let ref):
      return elements.contains { $0.ref == ref } ? .found(ref: ref) : .notFound
    case .semantic(let semantic):
      let role = semantic.role.map(normalize)
      let texts = [semantic.name, semantic.label, semantic.placeholder, semantic.text]
        .compactMap { $0 }.map(normalize)
      let matches = elements.filter { element in
        if let role, normalize(element.role) != role { return false }
        guard !texts.isEmpty else { return true }
        let name = normalize(element.name ?? "")
        return !name.isEmpty && texts.allSatisfy { $0 == name }
      }
      switch matches.count {
      case 0: return .notFound
      case 1: return .found(ref: matches[0].ref)
      default: return .ambiguous(count: matches.count)
      }
    }
  }

  /// The failure a non-match is reported as, with the message the agent sees.
  public var failure: ComputerErrorWire? {
    switch self {
    case .found: nil
    case .notFound:
      ComputerErrorWire(
        code: .notFound, message: "No element of the observation matches the locator.")
    case .ambiguous(let count):
      ComputerErrorWire(
        code: .ambiguous,
        message: "\(count) elements of the observation match the locator; make it more specific.")
    }
  }

  private static func normalize(_ text: String) -> String {
    text.split(whereSeparator: \.isWhitespace).joined(separator: " ").lowercased()
  }
}
