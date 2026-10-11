import AICore
import AppKit
import SwiftUI

/// A content's shape at rest, and how wide a capsule's texts may grow in it.
struct IslandMeasure: Equatable {
  let size: WindowSize
  var limits = IslandMetrics.CapsuleLimits()
}

/// Measuring the island's contents, synchronously and before anything shows, so the first frame
/// of a shape is already its content's size.
extension IslandController {
  /// The rest size of `content`: a capsule as wide as its row, never wider than
  /// ``IslandMetrics/maxShape`` (its values chip, then its command name, then a notice's message
  /// give way: ``IslandMetrics/CapsuleLimits/fitting(overflow:command:summary:message:)``); the
  /// card as wide as its widest row or footer within bounds and as tall as its rows make room
  /// for; the answer card as ``measureAnswer(command:answer:note:)`` has it.
  func measure(_ content: IslandContent) -> IslandMeasure {
    if case .answer(let command, let answer, let note) = content {
      return measureAnswer(command: command, answer: answer, note: note)
    }
    guard case .choose(let command) = content else { return measureCapsule(content) }
    guard let card = model.card else {
      return IslandMeasure(
        size: WindowSize(
          width: IslandMetrics.minCardWidth,
          height: IslandMetrics.cardHeight(rows: 1, filter: false)))
    }
    let ideal = NSHostingView(
      rootView: IslandCard(model: model, command: command, card: card, active: false).fixedSize()
    ).fittingSize
    return IslandMeasure(
      size: WindowSize(
        width: IslandMetrics.cardWidth(ideal: ideal.width),
        height: IslandMetrics.cardHeight(rows: card.capacity, filter: card.showsFilter)))
  }

  private func measureCapsule(_ content: IslandContent) -> IslandMeasure {
    let limit = IslandMetrics.maxShape.width
    let natural = capsuleWidth(content, IslandMetrics.CapsuleLimits())
    guard natural > limit else { return capsule(natural, IslandMetrics.CapsuleLimits()) }
    // The widths the texts take now, measured as the capsule draws them: the working name is
    // the shimmer label, the press name plain text.
    var command: Double?
    var summary: String?
    var message: String?
    switch content {
    case .press(let name):
      command = IslandType.width(of: name, limit: IslandMetrics.maxCommandWidth)
    case .working(let name, let values):
      command = IslandShimmer.width(of: name, limit: IslandMetrics.maxCommandWidth)
      summary = values
    case .notice(let text): message = text
    case .choose, .answer, .writing, .done, .copied: break
    }
    let limits = IslandMetrics.CapsuleLimits.fitting(
      overflow: natural - limit, command: command,
      summary: summary.map {
        IslandType.width(of: $0, size: 12, limit: IslandMetrics.maxSummaryWidth)
      },
      message: message.map { IslandType.width(of: $0, limit: IslandMetrics.maxMessageWidth) })
    return capsule(min(capsuleWidth(content, limits), limit), limits)
  }

  private func capsuleWidth(_ content: IslandContent, _ limits: IslandMetrics.CapsuleLimits)
    -> Double
  {
    let view = IslandCapsule(model: model, content: content, limits: limits).fixedSize()
    return NSHostingView(rootView: view).fittingSize.width.rounded(.up)
  }

  private func capsule(_ width: Double, _ limits: IslandMetrics.CapsuleLimits) -> IslandMeasure {
    IslandMeasure(
      size: WindowSize(width: width, height: IslandMetrics.capsuleHeight), limits: limits)
  }
}
