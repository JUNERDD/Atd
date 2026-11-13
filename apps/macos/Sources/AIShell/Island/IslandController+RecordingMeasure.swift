import AICore
import AppKit
import SwiftUI

extension IslandController {
  /// Fits the natural stack inside the work area, keeping Ask, chips and footer visible.
  /// Steps, notes and the answer scroll independently before outer scrolling is needed. The
  /// card keeps its width; the recording shows larger only in its lightbox.
  func measureRecordingCard() -> IslandMeasure {
    let room = screenRoom()
    let width = min(IslandMetrics.recordingCardWidth, room.width)
    guard let card = model.recordingCard else {
      return IslandMeasure(
        size: WindowSize(width: width, height: IslandMetrics.recordingChromeHeight))
    }
    let labels = model.labels.recording.asking
    let inner = max(width - IslandMetrics.cardPadding * 2 - IslandMetrics.recordingInset * 2, 1)
    let answer = answerFloor(
      card.asking, labels: labels, cap: IslandMetrics.recordingAnswerCap, width: width,
      seeks: true)
    let notes: Double
    if card.source.notes.isEmpty {
      notes = 0
    } else if let cached = card.measuredNotes, cached.width == inner {
      notes = cached.height
    } else {
      let measured = min(
        Self.height(of: IslandRecordingNotes(notes: card.source.notes), width: inner).rounded(.up),
        IslandMetrics.recordingNotesCap)
      card.measuredNotes = (inner, measured)
      notes = measured
    }
    let layout = IslandMetrics.recordingCardLayout(
      aspect: card.source.aspect, player: card.preferredPlayer, answer: answer, notes: notes,
      quickAsks: labels.quickHeight(width: inner), room: room)
    card.setLayout(layout)
    return IslandMeasure(size: layout.size)
  }
}
