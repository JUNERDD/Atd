import CoreGraphics

/// The recording result card's geometry (architecture R9, `record-result.js`): the cards'
/// corner, padding, title row and footer around a player with the steps beside it, the
/// filmstrip timeline under them, the ask field with its quick asks, the answer slot and the
/// footer. The recording shows larger only in the card's lightbox
/// (``recordingLightboxLayout(area:recorded:aspect:dockedPanel:)``).
extension IslandMetrics {
  public static let recordingCardWidth = 632.0
  /// The small player's room: it shows the recording at its own shape inside it.
  public static let recordingPlayerRoom = WindowSize(width: 260, height: 200)
  public static let recordingPlayerRadius = 10.0
  /// The sections' inset inside the card's padding, as a row's text.
  public static let recordingInset = rowPadding
  /// Between the player and the steps column.
  public static let recordingBodyGap = 12.0
  /// Above the player, under the title row.
  public static let recordingBodyTop = 4.0
  public static let recordingStepHeight = 28.0
  public static let recordingStepGap = 1.0
  public static let recordingStepsHeader = 22.0
  /// Between the body, the timeline, the ask field and the answer.
  public static let recordingSectionGap = 10.0
  /// The timeline's track: the filmstrip, and the band of step marks under it.
  public static let recordingFilmHeight = 32.0
  public static let recordingMarksBand = 12.0
  public static let recordingTrackHeight = recordingFilmHeight + recordingMarksBand
  public static let recordingFilmRadius = 6.0
  /// A filmstrip frame's height in the strip's thumbnails; their width follows the recording.
  public static let recordingFrameHeight = 32.0
  /// The trim handles' width and the thickness of the range's top and bottom edges.
  public static let recordingHandleWidth = 10.0
  public static let recordingRangeEdge = 3.0
  /// The time shown beside the strip reserves `00:00 / 00:00` (hours too from an hour on).
  public static let recordingClockGap = 8.0
  public static let recordingAskHeight = 32.0
  public static let recordingAskTop = 2.0
  public static let recordingAskBottom = 2.0
  public static let recordingQuickAskHeight = 24.0
  public static let recordingQuickAskGap = 8.0
  /// The answer slot: a separator and its padding, its title row, then its text.
  public static let recordingAnswerTop = 6.0
  public static let recordingAnswerRule = 1.0
  public static let recordingAnswerHeader = 28.0
  /// The complete answer scroll body, including its text insets, grows to this cap.
  public static let recordingAnswerCap = 160.0
  /// The answer's text starts under its title, past the title's glyph.
  public static let recordingAnswerIndent = 30.0
  public static let recordingAnswerTextTop = 2.0
  public static let recordingAnswerTextBottom = 4.0
  public static let recordingNotesCap = 72.0

  /// The card's height without its player and its answer slot: its grabber's strip and padding
  /// (``resultPadding``), the title row, the gaps, the timeline, the ask field and the footer.
  public static var recordingChromeHeight: Double {
    resultPadding + headerHeight + recordingBodyTop + recordingSectionGap
      + recordingTrackHeight + recordingSectionGap + recordingAskTop + recordingAskHeight
      + recordingQuickAskGap + recordingQuickAskHeight + recordingAskBottom + sectionGap
      + footerHeight
  }

  /// The answer slot's height around a scroll body `text` points tall, including text insets.
  public static func recordingAnswerSlot(text: Double) -> Double {
    recordingSectionGap + recordingAnswerRule + recordingAnswerTop + recordingAnswerHeader
      + max(text, 0)
  }

  /// The natural stack fitted to a work area (``ShellCardLayout``, its media the player). Only
  /// the preview, answer body and notes lose height; the title, timeline, Ask, chips and footer
  /// keep their normal control sizes.
  public typealias RecordingCardLayout = ShellCardLayout

  public static func recordingCardLayout(
    aspect: Double, player: WindowSize, answer: Double?, notes: Double, quickAsks: Double,
    room: WindowSize
  ) -> RecordingCardLayout {
    let body = answer ?? 0
    let notes = min(max(notes, 0), recordingNotesCap)
    let fixed =
      recordingChromeHeight + max(quickAsks - recordingQuickAskHeight, 0)
      + (answer == nil ? 0 : recordingAnswerSlot(text: 0))
      + (notes > 0 ? recordingBodyTop * 2 : 0)
    var excess = max(fixed + player.height + body + notes - room.height, 0)
    // First scroll the answer down to one full line, then the notes to one line. The
    // preview may shrink after that, but its 44 pt play target must still fit.
    let answerReduction = min(excess, max(body - shellAnswerMinimum, 0))
    let answerHeight = body - answerReduction
    excess -= answerReduction
    let notesReduction = min(excess, max(notes - 16, 0))
    let notesHeight = notes - notesReduction
    excess -= notesReduction
    let playerHeight = max(min(player.height, 44), player.height - excess)
    let fitted = recordingPlayer(
      aspect: aspect, in: WindowSize(width: player.width, height: playerHeight))
    let height = fixed + fitted.height + answerHeight + notesHeight
    return RecordingCardLayout(
      size: WindowSize(
        width: min(recordingCardWidth, room.width), height: min(height, room.height)),
      media: fitted, answerSlotHeight: answer == nil ? 0 : recordingAnswerSlot(text: answerHeight),
      notesHeight: notesHeight,
      quickAsksHeight: quickAsks, contentHeight: height)
  }

  /// The largest size of a recording `aspect` wide per point of height inside `room`.
  public static func recordingPlayer(aspect: Double, in room: WindowSize) -> WindowSize {
    guard aspect > 0, room.width > 0, room.height > 0 else {
      return WindowSize(width: 0, height: 0)
    }
    if room.width / room.height > aspect {
      return WindowSize(width: (room.height * aspect).rounded(), height: room.height.rounded())
    }
    return WindowSize(width: room.width.rounded(), height: (room.width / aspect).rounded())
  }

  /// How many frames a filmstrip `film` points tall shows across `width` points: as many as fit
  /// at the recording's shape, never fewer than six.
  public static func recordingFilmSlots(
    width: Double, aspect: Double, film: Double = recordingFrameHeight
  ) -> Int {
    let frame = film * max(aspect, 0.1)
    return max(6, Int((width / frame).rounded()))
  }
}

/// The timeline's hover frame (the result preview's direction D): a bubble above the pointer on
/// the filmstrip with the frame at that moment and its time, in the card and in the lightbox.
extension IslandMetrics {
  /// The bubble's frame: as wide as `width`, as tall as the recording's shape makes it up to
  /// `maxHeight` (a tall recording then shows inside it on black).
  public struct RecordingBubbleSize: Equatable, Sendable {
    public let width: Double
    public let maxHeight: Double

    public init(width: Double, maxHeight: Double) {
      self.width = width
      self.maxHeight = maxHeight
    }

    /// The card's bubble and the lightbox's larger one.
    public static let card = RecordingBubbleSize(width: 192, maxHeight: 120)
    public static let lightbox = RecordingBubbleSize(width: 256, maxHeight: 160)

    /// The frame's box for a recording `aspect` wide per point of height.
    public func frame(aspect: Double) -> WindowSize {
      WindowSize(width: width, height: min((width / max(aspect, 0.1)).rounded(), maxHeight))
    }
  }

  public static let recordingBubbleRadius = 8.0
  /// The bubble's inset around its frame, and the row under the frame with the time.
  public static let recordingBubblePadding = 4.0
  public static let recordingBubbleLabel = 22.0
  /// Between the bubble and the strip under it, and between the bubble and the edges of what it
  /// is clamped inside (the card, the screen).
  public static let recordingBubbleGap = 8.0

  /// The bubble's whole size around a frame of `frame`.
  public static func recordingBubble(frame: WindowSize) -> WindowSize {
    WindowSize(
      width: frame.width + recordingBubblePadding * 2,
      height: frame.height + recordingBubblePadding + recordingBubbleLabel)
  }

  /// Where a bubble of `size` stands (its top-left corner) for the pointer at `x` over a strip
  /// whose top is at `stripTop`, inside `bounds` (all in the same space, y down): centred over
  /// the pointer and above the strip, moved in to stay ``recordingBubbleGap`` inside the bounds.
  public static func recordingBubbleOrigin(
    x: Double, stripTop: Double, size: WindowSize, bounds: WindowSize
  ) -> CGPoint {
    let gap = recordingBubbleGap
    let left = min(max(x - size.width / 2, gap), max(bounds.width - size.width - gap, gap))
    let top = max(stripTop - gap - size.height, gap)
    return CGPoint(x: left, y: top)
  }
}

/// The recording's lightbox (`IslandRecordingLightbox`): the player on a stage in the media
/// column, the top bar over the column and the two-row bottom bar with the larger filmstrip under
/// it, and the side panel with the steps on the right (``lightboxPanel(shown:in:between:)``).
/// Chrome stays inside the work area; the player never shows larger than the recording's own point
/// size.
extension IslandMetrics {
  public static let recordingLightboxFilmHeight = 36.0
  /// The stage's top below the work area's top, and its sides' gutter (beside a docked panel too).
  public static let recordingLightboxTop = 72.0
  public static let recordingLightboxGutter = 32.0
  /// The bottom bar: two rows (the timeline, then the hints and actions) in a rounded rectangle,
  /// at least this wide unless the column is narrower, and the gap above it.
  public static let recordingLightboxBarMinWidth = 760.0
  public static let recordingLightboxBarRadius = 22.0
  public static let recordingLightboxBarPadding = 8.0
  public static let recordingLightboxBarRowGap = 6.0
  public static let recordingLightboxBarGap = 16.0
  public static var recordingLightboxBarHeight: Double {
    recordingLightboxBarPadding * 2 + recordingLightboxFilmHeight + recordingMarksBand
      + recordingLightboxBarRowGap + controlSide
  }

  /// Where the lightbox's pieces stand (top-left origin, the window's coordinates).
  public struct RecordingLightboxLayout: Equatable, Sendable {
    /// The media column: what the stage centres in, and what both bars centre over.
    public let column: CGRect
    /// The player at rest.
    public let player: CGRect
    /// The bottom bar's width.
    public let barWidth: Double
  }

  /// The layout in a work area `area`, for a recording `recorded` points large and `aspect` wide
  /// per point of height, left of the side panel while it docks at `dockedPanel`.
  public static func recordingLightboxLayout(
    area: CGRect, recorded: WindowSize, aspect: Double, dockedPanel: CGRect?
  ) -> RecordingLightboxLayout {
    let top = area.minY + recordingLightboxTop
    let bottom =
      area.maxY - lightboxBottomInset - recordingLightboxBarHeight - recordingLightboxBarGap
    let left = area.minX + recordingLightboxGutter
    let right = (dockedPanel?.minX ?? area.maxX) - recordingLightboxGutter
    let column = CGRect(
      x: left, y: top, width: max(right - left, 0), height: max(bottom - top, 0))
    let size = recordingPlayer(
      aspect: aspect,
      in: WindowSize(
        width: min(column.width, recorded.width), height: min(column.height, recorded.height)))
    let player = CGRect(
      x: column.midX - size.width / 2, y: column.midY - size.height / 2, width: size.width,
      height: size.height)
    return RecordingLightboxLayout(
      column: column, player: player,
      barWidth: min(max(size.width, recordingLightboxBarMinWidth), column.width))
  }

  /// The rows the bars leave free in a work area `area`: from the top bar's bottom to the bottom
  /// bar's top, where the side panel stands as a drawer.
  public static func recordingLightboxBetweenBars(in area: CGRect) -> ClosedRange<CGFloat> {
    let top = area.minY + lightboxTopInset + lightboxTopBarHeight
    return top...max(area.maxY - lightboxBottomInset - recordingLightboxBarHeight, top)
  }
}
