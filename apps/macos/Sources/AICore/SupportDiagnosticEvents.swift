import Foundation

/// Optional support-build observer. Callers supply reviewed metadata, never request bodies,
/// URLs, credentials or arbitrary error text. A normal build leaves the sink unset.
@MainActor
public enum SupportDiagnosticEvents {
  public static var sink:
    ((_ name: String, _ details: [String: JSONValue], _ correlation: Int?) -> Int)?

  @discardableResult
  public static func record(
    _ name: String, details: @autoclosure () -> [String: JSONValue] = [:],
    correlation: Int? = nil
  ) -> Int {
    guard let sink else { return 0 }
    return sink(name, details(), correlation)
  }
}
