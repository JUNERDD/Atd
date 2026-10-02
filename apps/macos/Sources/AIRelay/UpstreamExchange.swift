import Foundation

/// One upstream HTTP exchange whose response is streamed as it arrives: the head goes to
/// `onResponse`, which may turn it down (a replayed 409), then each chunk to `onData`, then one
/// `onComplete`. Redirects are not followed. Callbacks arrive on the main queue
/// (``RelaySession/shared``) and stop once ``cancel()`` was called.
///
/// Explicitly main-actor: a type conforming to the `Sendable` URLSession delegate protocols is
/// otherwise inferred nonisolated, not given the target's default isolation.
@MainActor
final class UpstreamExchange: NSObject, URLSessionDataDelegate {
  enum Disposition {
    case stream
    case discard
  }

  private let onResponse: @MainActor (HTTPURLResponse) -> Disposition
  private let onData: @MainActor (Data) -> Void
  private let onComplete: @MainActor ((any Error)?) -> Void
  private var task: URLSessionDataTask?
  private var done = false

  init(
    onResponse: @escaping @MainActor (HTTPURLResponse) -> Disposition,
    onData: @escaping @MainActor (Data) -> Void,
    onComplete: @escaping @MainActor ((any Error)?) -> Void
  ) {
    self.onResponse = onResponse
    self.onData = onData
    self.onComplete = onComplete
  }

  func start(_ request: URLRequest, session: URLSession = RelaySession.shared) {
    let task = session.dataTask(with: request)
    task.delegate = self
    self.task = task
    task.resume()
  }

  /// Stops the exchange; no callback runs afterwards.
  func cancel() {
    done = true
    task?.cancel()
    task = nil
  }

  private func end(_ error: (any Error)?) {
    guard !done else { return }
    done = true
    task = nil
    onComplete(error)
  }

  nonisolated func urlSession(
    _ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse,
    completionHandler: @escaping @Sendable (URLSession.ResponseDisposition) -> Void
  ) {
    MainActor.assumeIsolated {
      guard !done, let http = response as? HTTPURLResponse else {
        completionHandler(.cancel)
        if !done { end(URLError(.badServerResponse)) }
        return
      }
      switch onResponse(http) {
      case .stream:
        completionHandler(.allow)
      case .discard:
        done = true
        task = nil
        completionHandler(.cancel)
      }
    }
  }

  nonisolated func urlSession(
    _ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data
  ) {
    MainActor.assumeIsolated {
      guard !done else { return }
      onData(data)
    }
  }

  nonisolated func urlSession(
    _ session: URLSession, task: URLSessionTask, didCompleteWithError error: (any Error)?
  ) {
    MainActor.assumeIsolated { end(error) }
  }

  /// The relay answers with the redirect itself (its `Location` is not forwarded), never
  /// following it to another origin with the credential.
  nonisolated func urlSession(
    _ session: URLSession, task: URLSessionTask,
    willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest,
    completionHandler: @escaping @Sendable (URLRequest?) -> Void
  ) {
    completionHandler(nil)
  }
}
