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
  /// Result cards fit their current display as well as the island's width limit. The anchor
  /// owns the display while visible; a fresh appearance follows the pointer, as placement does.
  func resultCardWidth(ideal: Double) -> Double {
    let width = min(
      max(ideal.rounded(.up), IslandMetrics.minCardWidth), IslandMetrics.maxShape.width)
    let point = anchor ?? NSEvent.mouseLocation
    guard let screen = NSScreen.screens.first(where: { $0.frame.contains(point) }) ?? NSScreen.main
    else { return width }
    let available = screen.visibleFrame.width - SelectionToolbarPlacement.margin * 2
    return min(width, max(available, 1))
  }

  /// The rest size of `content`: a capsule as wide as its row, never wider than
  /// ``IslandMetrics/maxShape`` (its values chip, then its command name, then a notice's message
  /// give way: ``IslandMetrics/CapsuleLimits/fitting(overflow:command:summary:message:)``); the
  /// card as wide as its widest row or footer within bounds and as tall as its rows make room
  /// for; the answer card as ``measureAnswer(command:answer:note:)`` has it, the review card as
  /// ``measureReview(command:answer:note:review:)``, the compose card as
  /// ``measureCompose(command:attach:)`` does, the recording's result card as
  /// ``measureRecordingCard()`` does, the long screenshot's as ``measureLongScreenshotCard()``.
  func measure(_ content: IslandContent) -> IslandMeasure {
    if case .recordingResult = content { return measureRecordingCard() }
    if case .longScreenshotResult = content { return measureLongScreenshotCard() }
    if case .answer(let command, let answer, let note) = content {
      return measureAnswer(command: command, answer: answer, note: note)
    }
    if case .review(let command, let answer, let note, let review) = content {
      return measureReview(command: command, answer: answer, note: note, review: review)
    }
    if case .compose(let command, let attach) = content {
      return measureCompose(command: command, attach: attach)
    }
    guard case .choose(let command) = content else { return measureCapsule(content) }
    guard let card = model.card else {
      return IslandMeasure(
        size: WindowSize(
          width: IslandMetrics.minCardWidth,
          height: IslandMetrics.cardHeight(rows: 1, filter: false)))
    }
    let ideal = Self.fittingSize(
      of: IslandCard(model: model, command: command, card: card, active: false).fixedSize())
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
    case .choose, .answer, .review, .compose, .writing, .done, .copied: break
    case .recording, .recordingStatus, .recordingDiscard, .recordingResult: break
    case .longScreenshotResult: break
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
    return Self.fittingSize(of: view).width.rounded(.up)
  }

  /// Measures `view` using a persistent `NSHostingView` keyed by its concrete type, avoiding
  /// per-measurement hosting view allocations.
  static func fittingSize<Content: View>(of view: Content) -> CGSize {
    IslandMeasureHost.fittingSize(of: view)
  }

  private func capsule(_ width: Double, _ limits: IslandMetrics.CapsuleLimits) -> IslandMeasure {
    IslandMeasure(
      size: WindowSize(width: width, height: IslandMetrics.capsuleHeight), limits: limits)
  }
}

/// Wraps measured views with a fresh SwiftUI subtree identity per measurement so descendant
/// `.animation(_:value:)` modifiers (such as ``IslandReveal``) never interpolate from a
/// previous measurement's state while reusing the underlying `NSHostingView`.
private struct MeasuredView<Content: View>: View {
  let generation: Int
  let content: Content

  var body: some View {
    content
      .id(generation)
      .transaction {
        $0.animation = nil
        $0.disablesAnimations = true
      }
  }
}

/// Persistent per-type `NSHostingView` cache for synchronous off-screen SwiftUI measurement.
private enum IslandMeasureHost {
  private static var hosts: [ObjectIdentifier: AnyObject] = [:]
  private static var generation = 0

  static func fittingSize<Content: View>(of view: Content) -> CGSize {
    let key = ObjectIdentifier(Content.self)
    generation &+= 1
    var transaction = Transaction(animation: nil)
    transaction.disablesAnimations = true
    return withTransaction(transaction) {
      let wrapped = MeasuredView(generation: generation, content: view)
      let host: NSHostingView<MeasuredView<Content>>
      if let existing = hosts[key] as? NSHostingView<MeasuredView<Content>> {
        host = existing
        host.rootView = wrapped
      } else {
        let created = NSHostingView(rootView: wrapped)
        hosts[key] = created
        host = created
      }
      host.invalidateIntrinsicContentSize()
      host.layoutSubtreeIfNeeded()
      return host.fittingSize
    }
  }
}
