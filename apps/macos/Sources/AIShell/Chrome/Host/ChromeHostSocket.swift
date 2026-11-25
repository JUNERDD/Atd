import AIChromeChannelKit
import Darwin
import Foundation
import Synchronization
import os

/// One accepted socket to a native host, used by a reader thread, a write queue and the main
/// actor at once. The descriptor number must never be used after it is closed, since the kernel
/// may hand the same number to another file: every write runs on `writes`, the close runs there
/// too once the reader has stopped, and ``shutdown()``, which may run anywhere to wake a blocked
/// read or write, holds `closed`'s lock, which the close holds as well.
nonisolated final class ChromeHostSocket: Sendable {
  enum Event: Sendable {
    /// One frame body, in arrival order.
    case frame(Data)
    /// The peer closed, the socket was shut down, or a frame was malformed. Always last, once.
    case ended
  }

  private static let log = Logger(subsystem: "com.junerdd.ai", category: "chrome-host")

  private let descriptor: Int32
  private let writes = DispatchQueue(label: "com.junerdd.ai.chrome-host.writes")
  private let closed = Mutex(false)

  /// Takes ownership of `descriptor`, a connected, blocking stream socket.
  init(descriptor: Int32) {
    self.descriptor = descriptor
  }

  /// Closes the descriptor when no reader ever started; a started reader keeps this object alive
  /// until it closed the descriptor itself.
  deinit {
    closed.withLock { closed in
      if !closed { Darwin.close(descriptor) }
    }
  }

  /// Reads frame bodies of at most `limit` bytes on a thread of their own and posts each event to
  /// `deliver` on the main queue, in order, ending with ``Event/ended``. Call once.
  func startReading(limit: Int, deliver: @escaping @MainActor @Sendable (Event) -> Void) {
    let thread = Thread { [self] in
      let post: (Event) -> Void = { event in
        DispatchQueue.main.async { MainActor.assumeIsolated { deliver(event) } }
      }
      readFrames(limit: limit, post: post)
      post(.ended)
      writes.async { [self] in
        closed.withLock { closed in
          closed = true
          Darwin.close(descriptor)
        }
      }
    }
    thread.name = "Chrome host reader"
    thread.start()
  }

  /// Queues `frame` (already framed) after the frames before it; a failed write shuts the socket
  /// down, which ends the reader.
  func write(_ frame: Data) {
    writes.async { [self] in
      guard !closed.withLock({ $0 }) else { return }
      if !Self.writeAll(descriptor, frame) { shutdown() }
    }
  }

  /// Shuts the write side down once the frames queued before have been written, so a last frame
  /// (an `error` that explains the close) drains cleanly to the host before EOF; after `grace`
  /// regardless, ends both directions should a write still be blocked or the peer stay open.
  func shutdownAfterWrites(grace: DispatchTimeInterval = .seconds(1)) {
    writes.async { [self] in
      closed.withLock { closed in
        if !closed { _ = Darwin.shutdown(descriptor, SHUT_WR) }
      }
    }
    DispatchQueue.global().asyncAfter(deadline: .now() + grace) { [self] in shutdown() }
  }

  /// Ends both directions: a blocked read returns end of file and a blocked write fails, so the
  /// reader posts ``Event/ended`` and closes the descriptor.
  func shutdown() {
    closed.withLock { closed in
      if !closed { _ = Darwin.shutdown(descriptor, SHUT_RDWR) }
    }
  }

  private func readFrames(limit: Int, post: (Event) -> Void) {
    var reader = ChromeChannelFraming.Reader(limit: limit)
    var buffer = [UInt8](repeating: 0, count: 64 * 1024)
    while true {
      let count = buffer.withUnsafeMutableBytes {
        Darwin.read(descriptor, $0.baseAddress, $0.count)
      }
      if count < 0, errno == EINTR { continue }
      // End of file, a reset or a shutdown.
      guard count > 0 else { return }
      do throws(ChromeChannelFraming.Failure) {
        for body in try reader.append(Data(buffer[..<count])) { post(.frame(body)) }
      } catch {
        switch error {
        case .length(let length):
          Self.log.error("A Chrome host sent a frame of \(length) bytes; closing its connection")
        }
        return
      }
    }
  }

  /// Writes all of `data`, looping over partial writes; false when a write fails.
  private static func writeAll(_ descriptor: Int32, _ data: Data) -> Bool {
    data.withUnsafeBytes { raw -> Bool in
      guard let base = raw.baseAddress else { return true }
      var offset = 0
      while offset < raw.count {
        let wrote = Darwin.write(descriptor, base + offset, raw.count - offset)
        if wrote > 0 {
          offset += wrote
        } else if wrote < 0, errno == EINTR {
          continue
        } else {
          return false
        }
      }
      return true
    }
  }
}
