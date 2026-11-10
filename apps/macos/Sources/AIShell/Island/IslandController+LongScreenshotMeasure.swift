import AICore
import AppKit
import SwiftUI

extension IslandController {
  /// Fits the long screenshot card's natural stack inside the work area
  /// (``IslandMetrics/longScreenshotCardLayout(answer:quickAsks:room:)``), keeping Ask, chips and
  /// footer visible: the answer scrolls first, then the preview shrinks, and only then does the
  /// card scroll as a whole.
  func measureLongScreenshotCard() -> IslandMeasure {
    let room = screenRoom()
    guard let card = model.longScreenshotCard else {
      return IslandMeasure(
        size: WindowSize(
          width: min(IslandMetrics.longScreenshotCardWidth, room.width),
          height: IslandMetrics.longScreenshotChromeHeight))
    }
    let labels = model.labels.longScreenshot.asking
    let width = min(IslandMetrics.longScreenshotCardWidth, room.width)
    let inner = max(width - IslandMetrics.cardPadding * 2 - IslandMetrics.recordingInset * 2, 1)
    let answer = answerFloor(
      card.asking, labels: labels, cap: IslandMetrics.recordingAnswerCap, width: width,
      seeks: false)
    let layout = IslandMetrics.longScreenshotCardLayout(
      answer: answer, quickAsks: labels.quickHeight(width: inner), room: room)
    card.setLayout(layout)
    return IslandMeasure(size: layout.size)
  }
}
