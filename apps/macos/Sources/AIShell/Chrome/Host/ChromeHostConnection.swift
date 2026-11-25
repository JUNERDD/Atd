import AIChromeChannelKit
import Foundation
import Synchronization
import os

/// One admitted native host: the framed stream of one Chrome profile's extension. Its first frame
/// is the host's own `host.hello` (``ChromeHostHello``); every later one is the extension's.
/// Frames arrive in order on the main actor; ``send(_:)`` never blocks it. The connection ends
/// once, with ``onClose``, when the host closes, a frame is malformed, a write fails or a body is
/// refused; the owner's own ``close()`` ends it without calling ``onClose``. Dropping the last
/// reference closes it too.
final class ChromeHostConnection {
  private static let log = Logger(subsystem: "com.junerdd.ai", category: "chrome-host")

  /// The `atd-chrome-host` process at the other end, as the kernel recorded it at connect time.
  let peerPid: pid_t
  /// Each frame body (JSON, without its length prefix), in arrival order.
  var onFrame: ((Data) -> Void)?
  var onClose: (() -> Void)?

  private let socket: ChromeHostSocket
  private let open = Mutex(true)
  private var isOpen: Bool { open.withLock { $0 } }

  init(socket: ChromeHostSocket, peerPid: pid_t) {
    self.socket = socket
    self.peerPid = peerPid
    socket.startReading(limit: ChromeChannelFraming.maxFromChrome) { [weak self] event in
      self?.handle(event)
    }
  }

  deinit {
    if open.withLock({ $0 }) { socket.shutdown() }
  }

  /// Sends one frame body towards Chrome, after the ones sent before it. Chrome takes at most
  /// ``ChromeChannelFraming/maxToChrome`` bytes per message, so the caller chunks larger frames
  /// (``ChromeChannelFraming/chunks(of:id:)``); a body over that limit, or an empty one, is not
  /// sent and ends the connection.
  func send(_ body: Data) {
    guard isOpen else { return }
    guard !body.isEmpty, body.count <= ChromeChannelFraming.maxToChrome else {
      Self.log.error("Refused to send a \(body.count)-byte frame to Chrome; closing the connection")
      socket.shutdown()
      return
    }
    socket.write(ChromeChannelFraming.frame(body))
  }

  /// Ends the connection once the frames sent before it are written; no frame or ``onClose``
  /// follows.
  func close() {
    guard
      open.withLock({ isOpen in
        guard isOpen else { return false }
        isOpen = false
        return true
      })
    else { return }
    socket.shutdownAfterWrites()
  }

  private func handle(_ event: ChromeHostSocket.Event) {
    guard isOpen else { return }
    switch event {
    case .frame(let body):
      onFrame?(body)
    case .ended:
      open.withLock { $0 = false }
      onClose?()
    }
  }
}
