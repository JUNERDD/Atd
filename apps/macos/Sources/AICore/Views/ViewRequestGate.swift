import Foundation

/// The request checks of the `ai-view://view/…` handler, all made before anything reaches the
/// service. Only the renderer page frames views, so WebKit must name the renderer as the request's
/// main document, which the page cannot set: a request without one, or made under any other page,
/// is refused, and so is one whose `Origin` names another origin (a sandboxed view's own requests
/// carry `null`; a frame's navigation carries none). Documents take GET and HEAD.
public enum ViewRequestGate {
  public enum Refusal: Error, Equatable, Sendable {
    /// No main document, a main document other than the renderer page, or a foreign `Origin`.
    case foreignDocument
    /// A method other than GET and HEAD.
    case methodNotAllowed
    /// Not a view's URL (``ViewOrigin/document(of:)``).
    case notFound

    public var status: Int {
      switch self {
      case .foreignDocument: 403
      case .methodNotAllowed: 405
      case .notFound: 404
      }
    }

    /// For the renderer's developer, in the service's error envelope; English like the relay's
    /// other refusals.
    public var message: String {
      switch self {
      case .foreignDocument: "Views are served only inside the renderer page."
      case .methodNotAllowed: "View documents take GET and HEAD only."
      case .notFound: "No such view."
      }
    }
  }

  public static func check(
    method: String, url: URL?, headers: [String: String], mainDocumentURL: URL?
  ) -> Result<ViewDocument, Refusal> {
    guard let mainDocumentURL, RelayRequestGate.checkDocument(mainDocumentURL) == nil,
      RelayRequestGate.checkOrigin(headers: headers) == nil
    else { return .failure(.foreignDocument) }
    guard RelayRequestGate.isSafe(method) else { return .failure(.methodNotAllowed) }
    guard let document = ViewOrigin.document(of: url) else { return .failure(.notFound) }
    return .success(document)
  }
}
