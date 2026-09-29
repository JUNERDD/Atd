import AICore
import Foundation
import WebKit

/// The scheme tasks that may still be answered (spike S1). WebKit raises an exception when a
/// stopped task is called, so every answer goes through a ``SchemeResponder`` that goes quiet
/// once the task stops or finishes. Entries hold the task itself: an `ObjectIdentifier` alone
/// would let a freed task's address be reused by a new one while still listed.
@MainActor
final class SchemeTaskTable {
  private var live: [ObjectIdentifier: SchemeResponder] = [:]

  var count: Int { live.count }

  func open(_ task: any WKURLSchemeTask) -> SchemeResponder {
    let responder = SchemeResponder(task: task) { [weak self] id in self?.live[id] = nil }
    live[responder.id] = responder
    return responder
  }

  /// WebKit's stop: the responder goes quiet and cancels the work it was waiting for.
  func stop(_ task: any WKURLSchemeTask) {
    live.removeValue(forKey: ObjectIdentifier(task))?.stopped()
  }

  /// Every live task, for teardown.
  func stopAll() {
    let all = live.values
    live = [:]
    for responder in all { responder.stopped() }
  }
}

/// Answers one scheme task at most once: a response head, body chunks, then finish or fail.
@MainActor
final class SchemeResponder {
  let id: ObjectIdentifier
  private var task: (any WKURLSchemeTask)?
  private var responded = false
  private let release: @MainActor (ObjectIdentifier) -> Void
  /// Cancels upstream work; run once if WebKit stops the task first.
  var onStop: (@MainActor () -> Void)?

  init(task: any WKURLSchemeTask, release: @escaping @MainActor (ObjectIdentifier) -> Void) {
    self.id = ObjectIdentifier(task)
    self.task = task
    self.release = release
  }

  var isLive: Bool { task != nil }
  var request: URLRequest? { task?.request }

  /// Sends the head. Content of a HEAD request is dropped by ``send(_:)`` callers.
  func respond(status: Int, headers: [String: String]) {
    guard let task, !responded, let url = task.request.url,
      let response = HTTPURLResponse(
        url: url, statusCode: status, httpVersion: "HTTP/1.1", headerFields: headers)
    else { return }
    responded = true
    task.didReceive(response)
  }

  func send(_ data: Data) {
    guard let task, responded, !data.isEmpty else { return }
    task.didReceive(data)
  }

  func finish() {
    guard let task, responded else { return }
    task.didFinish()
    close()
  }

  /// A failure before any head becomes a network error in the page; after the head, the body is
  /// cut short.
  func fail(_ error: any Error) {
    guard let task else { return }
    task.didFailWithError(error)
    close()
  }

  /// A complete answer made by the relay itself, in the service's error envelope.
  func error(status: Int, _ message: String) {
    let body = RelayErrorBody.json(status: status, message: message)
    complete(
      status: status,
      headers: [
        "Content-Type": RelayErrorBody.contentType, "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      ], body: body)
  }

  /// Head, whole body and finish; the body is dropped for HEAD requests.
  func complete(status: Int, headers: [String: String], body: Data) {
    var headers = headers
    headers["Content-Length"] = String(body.count)
    respond(status: status, headers: headers)
    if task?.request.httpMethod != "HEAD" { send(body) }
    finish()
  }

  fileprivate func stopped() {
    task = nil
    let cancel = onStop
    onStop = nil
    cancel?()
  }

  private func close() {
    task = nil
    onStop = nil
    release(id)
  }
}
