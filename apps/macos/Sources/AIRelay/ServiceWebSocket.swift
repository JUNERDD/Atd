import AICore
import Foundation

/// One `URLSessionWebSocketTask` to the service's `/v1/stream` with the main token. It reports
/// open, each text frame, and exactly one close with the peer's code and reason unchanged; a
/// connection that fails without a close frame reports 1006 (abnormal closure). Callbacks arrive
/// on the main queue and stop after ``close(code:reason:)``.
///
/// Explicitly main-actor: a type conforming to the `Sendable` URLSession delegate protocols is
/// otherwise inferred nonisolated, not given the target's default isolation.
@MainActor
final class ServiceWebSocket: NSObject, URLSessionWebSocketDelegate {
  struct Events {
    var onOpen: @MainActor () -> Void
    var onText: @MainActor (String) -> Void
    /// The service never sends binary frames; the owner decides how to refuse one.
    var onBinary: @MainActor () -> Void
    var onClose: @MainActor (_ code: UInt16, _ reason: String) -> Void
  }

  /// RFC 6455 abnormal closure: the connection ended without a close frame.
  static let abnormalClosure: UInt16 = 1006
  /// Well above the service's largest frames (a `summaries` frame grows with the task count).
  static let maximumMessageSize = 64 * 1024 * 1024
  /// The subprotocol the service selects (`STREAM_PROTOCOL`).
  static let streamProtocol = "ai.v1"

  let endpoint: ServiceEndpoint
  private let events: Events
  private var task: URLSessionWebSocketTask?
  private var ended = false

  init(endpoint: ServiceEndpoint, events: Events) {
    self.endpoint = endpoint
    self.events = events
  }

  func start(session: URLSession = RelaySession.shared) {
    var request = URLRequest(url: endpoint.streamURL)
    request.setValue("Bearer \(endpoint.token)", forHTTPHeaderField: "Authorization")
    request.setValue(Self.streamProtocol, forHTTPHeaderField: "Sec-WebSocket-Protocol")
    let task = session.webSocketTask(with: request)
    task.maximumMessageSize = Self.maximumMessageSize
    task.delegate = self
    self.task = task
    task.resume()
  }

  func send(_ text: String) {
    guard !ended, let task else { return }
    task.send(.string(text)) { error in
      guard let error else { return }
      RelayLog.sockets.debug("A stream send failed: \(error.localizedDescription)")
    }
  }

  /// Closes the connection; no event is reported afterwards.
  func close(code: UInt16, reason: String) {
    guard !ended else { return }
    ended = true
    let closeCode = URLSessionWebSocketTask.CloseCode(rawValue: Int(code)) ?? .normalClosure
    task?.cancel(with: closeCode, reason: Data(reason.utf8))
    task = nil
  }

  private func receiveNext() {
    guard !ended, let task else { return }
    task.receive { result in
      MainActor.assumeIsolated {
        guard !self.ended else { return }
        switch result {
        case .success(.string(let text)):
          self.events.onText(text)
          self.receiveNext()
        case .success(.data):
          self.events.onBinary()
          self.receiveNext()
        case .success:
          self.receiveNext()
        case .failure:
          // A close frame, when there was one, is reported by the close or completion delegate.
          if task.closeCode != .invalid {
            self.finish(code: task.closeCode, reason: task.closeReason)
          }
        }
      }
    }
  }

  private func finish(code: URLSessionWebSocketTask.CloseCode, reason: Data?) {
    let numeric = code == .invalid ? Self.abnormalClosure : UInt16(clamping: code.rawValue)
    finish(numeric, reason.map { String(decoding: $0, as: UTF8.self) } ?? "")
  }

  private func finish(_ code: UInt16, _ reason: String) {
    guard !ended else { return }
    ended = true
    task = nil
    events.onClose(code, reason)
  }

  nonisolated func urlSession(
    _ session: URLSession, webSocketTask: URLSessionWebSocketTask,
    didOpenWithProtocol protocol: String?
  ) {
    MainActor.assumeIsolated {
      guard !ended else { return }
      events.onOpen()
      receiveNext()
    }
  }

  nonisolated func urlSession(
    _ session: URLSession, webSocketTask: URLSessionWebSocketTask,
    didCloseWith closeCode: URLSessionWebSocketTask.CloseCode, reason: Data?
  ) {
    MainActor.assumeIsolated { finish(code: closeCode, reason: reason) }
  }

  nonisolated func urlSession(
    _ session: URLSession, task: URLSessionTask, didCompleteWithError error: (any Error)?
  ) {
    MainActor.assumeIsolated {
      guard let socket = task as? URLSessionWebSocketTask, socket.closeCode != .invalid else {
        return finish(Self.abnormalClosure, error?.localizedDescription ?? "The connection ended.")
      }
      finish(code: socket.closeCode, reason: socket.closeReason)
    }
  }
}
