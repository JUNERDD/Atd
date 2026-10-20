import AICore
import AppKit

extension DeviceArbiter {
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
