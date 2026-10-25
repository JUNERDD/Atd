import AICore
import Foundation

/// The windows of generative views (agent-contracts `views.ts`), which the conversation's widgets
/// open (`view.open`): at most one per view, identified by its window document. Each is a renderer
/// page of its own (`#view?task=…&call=…`) whose frame loads that document from the view origin
/// (``ViewOrigin``). Nothing outlives a window: it opens at the size the view asks for, and
/// closing it releases its page.
final class ViewWindows {
  private let makeHost: (_ fragment: String) -> WebViewHost
  /// The open windows, the oldest first: a new one cascades from the last.
  private var windows: [ViewWindowController] = []

  init(makeHost: @escaping (_ fragment: String) -> WebViewHost) {
    self.makeHost = makeHost
  }

  /// The page of the view window that is key, for the Edit menu.
  var keyHost: WebViewHost? { windows.first(where: \.isKey)?.host }

  /// Brings the view's open window forward, or opens one titled `title` at the size the view asks
  /// for (``ViewWindowController/defaultSize`` where it names none). Ids the view origin refuses
  /// open nothing.
  func open(_ params: ViewOpenParams) throws(BridgeError) {
    guard
      let view = ViewOrigin.document(
        taskId: params.taskId, callId: params.callId, surface: .window)
    else { throw BridgeError("No such view.") }
    if let open = windows.first(where: { $0.view == view }) { return open.show() }
    let size = WindowSize(
      width: params.width.map { Double($0) } ?? ViewWindowController.defaultSize.width,
      height: params.height.map { Double($0) } ?? ViewWindowController.defaultSize.height)
    let window = ViewWindowController(
      view: view, host: makeHost(Self.fragment(view)), title: params.title, size: size,
      cascadingFrom: windows.last?.frame)
    window.onClose = { [weak self] in self?.windows.removeAll { $0.view == view } }
    windows.append(window)
    window.show()
  }

  /// The window page of `view`, `view?task=…&call=…`, its ids percent-encoded as query values.
  private static func fragment(_ view: ViewDocument) -> String {
    var query = URLComponents()
    query.queryItems = [
      URLQueryItem(name: "task", value: view.taskId),
      URLQueryItem(name: "call", value: view.callId),
    ]
    // `URLSearchParams` reads `+` as a space.
    let encoded = query.percentEncodedQuery?.replacingOccurrences(of: "+", with: "%2B")
    return "view?" + (encoded ?? "")
  }
}
