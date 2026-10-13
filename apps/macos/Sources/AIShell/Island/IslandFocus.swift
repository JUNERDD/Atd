import AICore
import AppKit

extension TextWriter {
  /// A net over the restore's AX messages, each bounded by the messaging timeout.
  private static let focusLimit: Duration = .seconds(1)

  /// Gives the keyboard back to `target`'s field after the command island's options card took
  /// it: the app is brought forward again even though it stayed frontmost (the card's window
  /// never activated Atd), and the field is focused with its recorded selection, as a write
  /// would put it (``FieldRestore`` in `cursor` mode, which never refuses a moved selection).
  /// Nothing is typed. A target that is gone, or an app that does not come forward, is left
  /// as it is.
  static func returnFocus(to target: WriteTarget) async {
    guard let app = NSRunningApplication(processIdentifier: target.pid), !app.isTerminated,
      await bringForward(app, reassert: true)
    else { return }
    let restore = FieldRestore(target: target, mode: .cursor)
    _ = await Deadline.value(within: focusLimit, fallback: .refused(.failed), { restore.run() })
  }
}
