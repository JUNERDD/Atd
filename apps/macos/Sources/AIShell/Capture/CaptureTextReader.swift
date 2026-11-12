import AICore
import AppKit

/// Reads the text of a committed selection while it is edited (architecture S5): the session
/// asks for a reading after a commit and after every settled move or resize, and ``onChange``
/// reports nil at once (reading), then what was read, in desktop points. A new request cancels
/// the one before; a cancelled or superseded request never reports. A request can wait for the
/// selection to stay put first: keyboard nudges come many a second, and each reading renders the
/// selection's pixels on the main actor and runs a Vision request, so of a burst only the
/// selection it ends on is rendered and read. A reading without pixels, that fails or that runs
/// past ``timeout`` reports ``CaptureText/empty``. The text stays in memory for the session only.
final class CaptureTextReader {
  /// Longer than the attachment's bound: nothing waits on this reading but the controls it feeds.
  static let timeout = Duration.seconds(10)
  /// How long a selection moved by the keyboard must stay put before it is read: longer than the
  /// gap between a held arrow's repeats at usual key-repeat rates, short enough that a single
  /// press is read promptly.
  static let settleDelay = Duration.milliseconds(300)

  var onChange: ((CaptureText?) -> Void)?
  private var reading: Task<Void, Never>?

  /// Reads `selection` (desktop points) once no other request came for `delay`: `pixels`
  /// renders its raw pixels then, and is never called for a request superseded before.
  func read(_ selection: CGRect, after delay: Duration = .zero, pixels: @escaping () -> CGImage?) {
    reading?.cancel()
    onChange?(nil)
    reading = Task { [weak self] in
      if delay > .zero { try? await Task.sleep(for: delay) }
      guard !Task.isCancelled else { return }
      var scan: ScreenText.Scan?
      if let image = pixels() {
        scan = await ScreenText.scan(in: image, timeout: Self.timeout, glyphs: true)
      }
      guard !Task.isCancelled, let self else { return }
      reading = nil
      onChange?(scan.map { Self.text($0, in: selection) } ?? .empty)
    }
  }

  /// Drops the reading in progress; nothing more is reported for it.
  func cancel() {
    reading?.cancel()
    reading = nil
  }

  /// `scan`'s normalized boxes in desktop points over `selection`.
  private static func text(_ scan: ScreenText.Scan, in selection: CGRect) -> CaptureText {
    func place(_ box: CGRect) -> CGRect {
      guard !box.isNull else { return .null }
      return CGRect(
        x: selection.minX + box.minX * selection.width,
        y: selection.minY + box.minY * selection.height, width: box.width * selection.width,
        height: box.height * selection.height)
    }
    return CaptureText(
      boxes: scan.boxes.map {
        ScreenContext.TextBox(text: $0.text, box: place($0.box), confidence: $0.confidence)
      },
      sensitive: scan.sensitive.map { SensitiveText.Box(kind: $0.kind, box: place($0.box)) },
      glyphs: CaptureTextGlyphs(
        runs: scan.glyphs.map { run in
          CaptureTextGlyphs.Run(
            text: run.text, box: place(run.box), characters: run.characters.map(place))
        }))
  }
}
