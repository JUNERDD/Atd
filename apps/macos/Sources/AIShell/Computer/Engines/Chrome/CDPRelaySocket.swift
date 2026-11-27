import AICore
import Foundation
import Network
import OSLog

/// One worker connection to a ``ChromeCDPRelay``: a loopback TCP connection that must open with the
/// relay's exact handshake (``CDPRelayHandshake``) within ``handshakeLimit``, then carries text
/// messages both ways (``WebSocketFrameDecoder``, ``WebSocketFrame``). It answers pings and the
/// peer's close itself; a protocol error closes it with the RFC 6455 status code. Everything runs
/// on the main queue.
final class CDPRelaySocket {
  private enum State {
    case handshaking
    case open
    case closing
    case closed
  }

  private static let log = Logger(subsystem: "com.junerdd.ai", category: "chrome-cdp")

  /// How long a connection may take to send its handshake.
  static let handshakeLimit: Duration = .seconds(10)

  /// The upgrade succeeded; set before any message is delivered.
  var onOpen: (() -> Void)?
  /// A text message from the worker.
  var onText: ((String) -> Void)?
  /// The connection ended, whichever side ended it; told once, and only after ``onOpen``.
  var onClose: (() -> Void)?
  /// Reports handshake and frame-decode failures to the shell log (`chrome-cdp`).
  var onDiagnostic: ((ShellLogWriter.Level, String) -> Void)?

  private let connection: NWConnection
  private let path: String
  private let host: String
  private var state = State.handshaking
  private var opened = false
  private var request: [UInt8] = []
  private var decoder = WebSocketFrameDecoder()
  private var handshakeTimer: Task<Void, Never>?

  init(connection: NWConnection, path: String, host: String) {
    self.connection = connection
    self.path = path
    self.host = host
  }

  func start() {
    connection.stateUpdateHandler = { [weak self] state in
      MainActor.assumeIsolated {
        switch state {
        case .failed(let error):
          Self.log.warning(
            "CDP relay socket failed: \(error.localizedDescription, privacy: .public)")
          self?.onDiagnostic?(.warn, "cdp_socket_failed: \(error.localizedDescription)")
          self?.finish()
        case .cancelled:
          self?.finish()
        default: break
        }
      }
    }
    connection.start(queue: .main)
    handshakeTimer = Task { [weak self] in
      try? await Task.sleep(for: Self.handshakeLimit)
      guard !Task.isCancelled, let self, case .handshaking = self.state else { return }
      Self.log.warning("CDP relay handshake timed out.")
      self.onDiagnostic?(.warn, "cdp_handshake_timeout")
      self.finish()
    }
    receive()
  }

  /// Sends one text message to the worker.
  func send(_ text: String) {
    guard case .open = state else { return }
    write(WebSocketFrame.text(text))
  }

  /// Closes with `code` (1001 when the relay goes away), then drops the connection.
  func close(code: UInt16) {
    switch state {
    case .handshaking: finish()
    case .open:
      state = .closing
      write(WebSocketFrame.close(code), then: { [weak self] in self?.finish() })
    case .closing, .closed: break
    }
  }

  private func receive() {
    connection.receive(minimumIncompleteLength: 1, maximumLength: 1 << 20) {
      [weak self] data, _, isComplete, error in
      MainActor.assumeIsolated {
        guard let self else { return }
        if let data, !data.isEmpty { self.consume(data) }
        if let error {
          Self.log.warning(
            "CDP relay receive failed: \(error.localizedDescription, privacy: .public)")
          self.onDiagnostic?(.warn, "cdp_receive_failed: \(error.localizedDescription)")
        }
        if isComplete || error != nil {
          self.finish()
        } else if case .closed = self.state {
          return
        } else {
          self.receive()
        }
      }
    }
  }

  private func consume(_ data: Data) {
    switch state {
    case .handshaking:
      request.append(contentsOf: data)
      switch CDPRelayHandshake.evaluate(request, path: path, host: host) {
      case .incomplete: return
      case .refuse(let response):
        let status =
          String(decoding: response, as: UTF8.self).split(separator: "\r\n", maxSplits: 1).first
          .map(String.init) ?? "refused"
        Self.log.warning("CDP relay handshake refused: \(status, privacy: .public)")
        onDiagnostic?(.warn, "cdp_handshake_refused status=\(status)")
        state = .closing
        write(response, then: { [weak self] in self?.finish() })
      case .accept(let response, let consumed):
        handshakeTimer?.cancel()
        let rest = Data(request[consumed...])
        request = []
        write(response)
        state = .open
        opened = true
        onOpen?()
        if !rest.isEmpty { frames(rest) }
      }
    case .open: frames(data)
    case .closing, .closed: return
    }
  }

  private func frames(_ data: Data) {
    decoder.append(data)
    do throws(WebSocketFrameDecoder.Failure) {
      while case .open = state, let event = try decoder.next() {
        switch event {
        case .text(let text): onText?(text)
        case .ping(let payload): write(WebSocketFrame.pong(payload))
        // The peer is closing: answer with a normal close, whatever its reason.
        case .close: close(code: 1000)
        }
      }
    } catch {
      Self.log.warning("CDP relay frame decode failed (ws code \(error.code, privacy: .public)).")
      onDiagnostic?(.warn, "cdp_frame_decode_failed code=\(error.code)")
      close(code: error.code)
    }
  }

  private func write(_ data: Data, then done: (@MainActor () -> Void)? = nil) {
    connection.send(
      content: data,
      completion: .contentProcessed { [weak self] error in
        MainActor.assumeIsolated {
          if let error {
            Self.log.warning(
              "CDP relay write failed: \(error.localizedDescription, privacy: .public)")
            self?.onDiagnostic?(.warn, "cdp_write_failed: \(error.localizedDescription)")
            self?.finish()
          }
          done?()
        }
      })
  }

  /// The connection is over: it is dropped, and the relay hears of it once.
  private func finish() {
    if case .closed = state { return }
    state = .closed
    handshakeTimer?.cancel()
    connection.cancel()
    let wasOpen = opened
    opened = false
    if wasOpen { onClose?() }
  }
}
