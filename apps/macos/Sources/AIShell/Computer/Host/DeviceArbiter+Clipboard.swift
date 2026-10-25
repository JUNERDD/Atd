import AICore
import AppKit

extension DeviceArbiter {
  /// A copy requested through an asynchronous bridge waits for pasteboard restoration before
  /// replacing it. The bound covers selection capture's late restore and an ordinary animated
  /// paste, without leaving an unresponsive transaction's copy pending indefinitely.
  @discardableResult
  func copyToClipboard(_ text: String) async -> Bool {
    guard
      let claim = try? await claim(
        [.clipboard], owner: .user(.clipboardWrite, requestId: UUID()),
        deadline: .now + .seconds(5))
    else { return false }
    defer { claim.release() }
    let pasteboard = NSPasteboard.general
    pasteboard.clearContents()
    return pasteboard.setString(text, forType: .string)
  }

  /// Runs a one-shot write of the general pasteboard under a clipboard claim of `feature`,
  /// released as soon as `write` returns. False, with the pasteboard untouched, while another
  /// owner's clipboard transaction holds it (a paste's write and restore, a copy and its late
  /// restore), which a write in the middle would corrupt.
  @discardableResult
  func writeClipboard(as feature: UserFeature, _ write: (NSPasteboard) -> Void) -> Bool {
    guard let claim = try? tryClaim([.clipboard], owner: .user(feature)) else { return false }
    defer { claim.release() }
    write(.general)
    return true
  }

  /// Replaces the general pasteboard with `text`, as ``writeClipboard(as:_:)`` does.
  @discardableResult
  func writeClipboard(_ text: String, as feature: UserFeature = .clipboardWrite) -> Bool {
    writeClipboard(as: feature) { pasteboard in
      pasteboard.clearContents()
      pasteboard.setString(text, forType: .string)
    }
  }
}
