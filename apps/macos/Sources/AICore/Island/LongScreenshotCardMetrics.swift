import CoreGraphics

/// The long screenshot card's geometry (decision D11, `longshot-result.js`): the recording
/// card's width, corner, padding, title row, ask field, quick asks, answer slot and footer
/// (``recordingCardWidth`` and its neighbours), around a body of the whole image in a preview box
/// with what Atd reads beside it. No timeline: the trim is on the preview itself.
extension IslandMetrics {
  public static let longScreenshotCardWidth = recordingCardWidth
  /// The preview's box: the whole image fits inside it at its own shape.
  public static let longScreenshotPreviewBox = WindowSize(width: 208, height: 300)
  /// A short work area shrinks the box down to this, keeping a page row and the side column's
  /// fixed rows beside it.
  public static let longScreenshotPreviewMinimum = 120.0
  public static let longScreenshotPreviewRadius = recordingPlayerRadius
  /// The image's own corner inside the box.
  public static let longScreenshotImageRadius = 3.0
  /// A trim handle's bar on the image's edge, and the strip around it that takes the pointer:
  /// as tall as the bar plus 6 pt each way, 8 pt past the image on both sides.
  public static let longScreenshotHandleBar = 4.0
  public static let longScreenshotHandleHit = 16.0
  public static let longScreenshotHandleOverhang = 8.0
  /// Between the page rows and the recognized text below them, around the rule.
  public static let longScreenshotRuleGap = 4.0

  /// The card's height without its preview and its answer slot: its grabber's strip and padding
  /// (``resultPadding``), the title row, the body's top, the ask field with its quick asks and
  /// the footer.
  public static var longScreenshotChromeHeight: Double {
    resultPadding + headerHeight + recordingBodyTop + recordingSectionGap + recordingAskTop
      + recordingAskHeight + recordingQuickAskGap + recordingQuickAskHeight + recordingAskBottom
      + sectionGap + footerHeight
  }

  /// The natural stack fitted to `room`: an answer scroll body `answer` points tall (nil without
  /// one) is scrolled down to one line first, then the preview shrinks toward
  /// ``longScreenshotPreviewMinimum``; the title, Ask, chips and footer keep their sizes, and only
  /// past that does the card scroll as a whole (``ShellCardLayout/contentHeight``).
  public static func longScreenshotCardLayout(
    answer: Double?, quickAsks: Double, room: WindowSize
  ) -> ShellCardLayout {
    let body = answer ?? 0
    let box = longScreenshotPreviewBox
    let fixed =
      longScreenshotChromeHeight + max(quickAsks - recordingQuickAskHeight, 0)
      + (answer == nil ? 0 : recordingAnswerSlot(text: 0))
    var excess = max(fixed + box.height + body - room.height, 0)
    let answerReduction = min(excess, max(body - shellAnswerMinimum, 0))
    let answerHeight = body - answerReduction
    excess -= answerReduction
    let previewHeight = max(min(box.height, longScreenshotPreviewMinimum), box.height - excess)
      .rounded()
    let height = fixed + previewHeight + answerHeight
    return ShellCardLayout(
      size: WindowSize(
        width: min(longScreenshotCardWidth, room.width), height: min(height, room.height)),
      media: WindowSize(width: box.width, height: previewHeight),
      answerSlotHeight: answer == nil ? 0 : recordingAnswerSlot(text: answerHeight),
      notesHeight: 0, quickAsksHeight: quickAsks, contentHeight: height)
  }

  /// The image's size at its own shape inside a preview box of `box`, `size` (points) large.
  public static func longScreenshotImage(_ size: CGSize, in box: WindowSize) -> WindowSize {
    guard size.width > 0, size.height > 0 else { return WindowSize(width: 0, height: 0) }
    let scale = min(box.width / size.width, box.height / size.height)
    return WindowSize(
      width: max((size.width * scale).rounded(), 1), height: max((size.height * scale).rounded(), 1)
    )
  }
}
