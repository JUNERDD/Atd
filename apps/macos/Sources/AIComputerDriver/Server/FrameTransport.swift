import AIComputerDriverKit
import Darwin
import Foundation
import OSLog

/// Length-prefixed JSON framing over stdin/stdout: a 4-byte big-endian length followed by that
/// many bytes of a JSON `DriverRequestFrame` (in) or `DriverOutgoing` (out). stdin closing is the
/// parent-liveness signal — `readFrame` returns nil and the server exits. stderr is for logs only
/// and never carries frames. Writes are serialized so responses from different per-pid executors
/// never interleave on the pipe.
final class FrameTransport: @unchecked Sendable {
  private let input: Int32
  private let output: Int32
  private let writeLock = NSLock()
  private let encoder = JSONEncoder()
  private let decoder = JSONDecoder()

  /// Frames larger than this are rejected as a framing error rather than trusted (a desync or a
  /// hostile length prefix must not drive an unbounded allocation).
  private static let maxFrameBytes = 64 * 1024 * 1024

  init(input: Int32 = 0, output: Int32 = 1) {
    self.input = input
    self.output = output
  }

  /// Read one request frame. Returns nil at EOF (parent gone) or on a framing error, which the
  /// server treats as a reason to exit.
  func readFrame() -> DriverRequestFrame? {
    guard let header = readExactly(4) else { return nil }
    let length = header.withUnsafeBytes { $0.load(as: UInt32.self).bigEndian }
    guard length > 0, Int(length) <= Self.maxFrameBytes, let body = readExactly(Int(length)) else {
      return nil
    }
    return try? decoder.decode(DriverRequestFrame.self, from: body)
  }

  func write(_ outgoing: DriverOutgoing) {
    guard let body = try? encoder.encode(outgoing) else { return }
    var header = UInt32(body.count).bigEndian
    writeLock.lock()
    defer { writeLock.unlock() }
    withUnsafeBytes(of: &header) { writeAll(Data($0)) }
    writeAll(body)
  }

  private func readExactly(_ count: Int) -> Data? {
    var buffer = Data(capacity: count)
    var remaining = count
    let chunk = UnsafeMutableRawPointer.allocate(byteCount: min(count, 65536), alignment: 1)
    defer { chunk.deallocate() }
    while remaining > 0 {
      let want = min(remaining, 65536)
      let got = read(input, chunk, want)
      if got > 0 {
        buffer.append(chunk.assumingMemoryBound(to: UInt8.self), count: got)
        remaining -= got
      } else if got == 0 {
        return nil  // EOF
      } else if errno == EINTR {
        continue
      } else {
        return nil
      }
    }
    return buffer
  }

  private func writeAll(_ data: Data) {
    data.withUnsafeBytes { raw in
      var offset = 0
      let base = raw.baseAddress!
      while offset < raw.count {
        let wrote = Darwin.write(output, base + offset, raw.count - offset)
        if wrote > 0 {
          offset += wrote
        } else if wrote < 0, errno == EINTR {
          continue
        } else {
          return
        }
      }
    }
  }
}

/// Diagnostic logging, never to stdout (the frame channel): `log` writes to stderr, which the shell
/// keeps in the driver's log file; `computer` is the app's own computer category of the unified
/// log, for a fact best read next to the host's lines there, such as a capability latched off.
enum DriverLog {
  static let computer = Logger(subsystem: "com.junerdd.ai", category: "computer")

  static func log(_ message: String) {
    FileHandle.standardError.write(Data("[atd-computer-driver] \(message)\n".utf8))
  }
}
