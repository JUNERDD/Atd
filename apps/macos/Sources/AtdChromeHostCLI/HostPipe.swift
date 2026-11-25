import AIChromeChannelKit
import Darwin
import Foundation

/// The two legs of the pipe: whole frames, read with the channel's ``ChromeChannelFraming/Reader``
/// under each leg's limit and written again with the same framing, so a frame that arrived
/// complete is the only thing either side ever receives.
nonisolated enum HostPipe {
  /// Pipes frames from `input` to `output` until one of them ends. Returns status 0 when either
  /// side closed (end of input, a reset, or a write to a side that is gone), else the failure.
  static func pump(from input: Int32, to output: Int32, limit: Int, peer: String) -> HostFailure {
    var reader = ChromeChannelFraming.Reader(limit: limit)
    var buffer = [UInt8](repeating: 0, count: 64 * 1024)
    while true {
      let count = buffer.withUnsafeMutableBytes { Darwin.read(input, $0.baseAddress, $0.count) }
      if count < 0 {
        let code = errno
        if code == EINTR { continue }
        if code == ECONNRESET { return HostFailure(status: 0, message: "") }
        return HostFailure(
          status: EX_IOERR, message: "reading from \(peer) failed (\(HostExit.reason(code)))")
      }
      guard count > 0 else { return HostFailure(status: 0, message: "") }
      let bodies: [Data]
      do throws(ChromeChannelFraming.Failure) {
        bodies = try reader.append(Data(buffer[..<count]))
      } catch {
        switch error {
        case .length(let length):
          return HostFailure(
            status: EX_DATAERR,
            message:
              "\(peer) sent a frame of \(length) bytes (limit \(limit)); the stream is out of sync"
          )
        }
      }
      for body in bodies where !writeAll(output, ChromeChannelFraming.frame(body)) {
        let code = errno
        if code == EPIPE || code == ECONNRESET { return HostFailure(status: 0, message: "") }
        return HostFailure(
          status: EX_IOERR, message: "writing \(peer)'s frame failed (\(HostExit.reason(code)))")
      }
    }
  }

  /// Writes all of `data`, looping over partial writes; false with `errno` set when a write fails.
  static func writeAll(_ descriptor: Int32, _ data: Data) -> Bool {
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
