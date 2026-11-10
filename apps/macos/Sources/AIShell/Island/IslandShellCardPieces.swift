import AICore
import SwiftUI

/// The shell cards' title row (the recording's result card, the long screenshot's): the card's
/// title, its subtitle cut with an ellipsis (the tooltip has it whole), "Restore" while there is
/// something to restore, and the close button.
struct IslandShellTitle: View {
  /// Restore, a text button in the link colour: its label, its tooltip and what it does.
  struct Restore {
    let label: String
    let tooltip: String
    let action: () -> Void
  }

  let model: IslandModel
  let title: String
  let subtitle: String
  let restore: Restore?
  let close: () -> Void

  var body: some View {
    HStack(spacing: 8) {
      Text(verbatim: title)
        .font(.system(size: 13, weight: .semibold))
        .foregroundStyle(.primary)
        .lineLimit(1)
        .fixedSize()
        .accessibilityAddTraits(.isHeader)
      Text(verbatim: subtitle)
        .font(.system(size: 13))
        .foregroundStyle(.secondary)
        .monospacedDigit()
        .lineLimit(1)
        .truncationMode(.tail)
        .help(subtitle)
      Spacer(minLength: 0)
      if let restore {
        // The island's text button, in the link colour: its washes on hover and press follow
        // the window's pointer tracker, which an inactive window's link style never shows.
        IslandTextButton(
          title: restore.label, tooltip: restore.tooltip, foreground: Color(nsColor: .linkColor),
          action: restore.action)
      }
      IslandIconButton(glyph: AnnotationIcons.cancel, label: model.labels.close, action: close)
    }
    .padding(.leading, IslandMetrics.rowPadding)
    .frame(height: IslandMetrics.headerHeight)
  }
}

/// The shell cards' footer, laid out as the command result cards' (``IslandResultFooter``):
/// Escape's hint, then the card's actions (`actions(compact)`), the last one primary, each on
/// what the card keeps now and each reporting how it went on its own button
/// (``IslandFeedbackButton``), so the card stays; the actions with a shortcut show its keycap
/// (``IslandShellFooterKey``). The complete row comes first; only constrained space compacts
/// secondary actions, then the keyboard hint.
struct IslandShellFooter<Actions: View>: View {
  let model: IslandModel
  @ViewBuilder let actions: (_ compact: Bool) -> Actions

  var body: some View {
    ViewThatFits(in: .horizontal) {
      row(compactActions: false, compactHint: false)
      row(compactActions: true, compactHint: false)
      row(compactActions: true, compactHint: true)
    }
    .padding(.leading, 4)
    .frame(height: IslandMetrics.footerHeight)
    .padding(.top, IslandMetrics.sectionGap)
  }

  private func row(compactActions: Bool, compactHint: Bool) -> some View {
    HStack(spacing: 10) {
      if compactHint {
        IslandKeycap(symbol: "esc")
          .help(model.labels.close)
          .accessibilityLabel(Text(verbatim: "esc " + model.labels.close))
      } else {
        IslandKeyHint(keys: "esc", label: model.labels.close)
      }
      Spacer(minLength: 8)
      HStack(spacing: IslandMetrics.gap) { actions(compactActions) }.fixedSize()
    }
  }
}

/// The shell card a layer shows and keeps while it leaves (``IslandLayer/shellCard``), so a
/// card forgotten meanwhile still leaves with its content: one card is one model.
enum IslandShellCard: Equatable {
  case recording(IslandRecordingCardModel)
  case longScreenshot(IslandLongScreenshotCardModel)

  /// The card's measured stack, which its layer reflows through (``IslandShellGeometry``).
  var layout: IslandMetrics.ShellCardLayout? {
    switch self {
    case .recording(let card): card.layout
    case .longScreenshot(let card): card.layout
    }
  }

  /// The first measurement: the reflow's baseline, so mounting never lays out from zero.
  var layoutOrigin: IslandMetrics.ShellCardLayout? {
    switch self {
    case .recording(let card): card.layoutOrigin
    case .longScreenshot(let card): card.layoutOrigin
    }
  }
}

extension IslandModel {
  /// The shell card a layer of `content` shows; nil for any other content.
  func shellCard(for content: IslandContent) -> IslandShellCard? {
    switch content {
    case .recordingResult: recordingCard.map(IslandShellCard.recording)
    case .longScreenshotResult: longScreenshotCard.map(IslandShellCard.longScreenshot)
    default: nil
    }
  }

  /// The kept shell card whose measurement the island's reflow follows while no layer shows one.
  var keptShellCard: IslandShellCard? {
    recordingCard.map(IslandShellCard.recording)
      ?? longScreenshotCard.map(IslandShellCard.longScreenshot)
  }
}

/// The measured regions of a shell card travel together, including bounded notes/answers on
/// short displays. Changes are relative to the first complete layout: mounting a card never
/// animates from zero.
nonisolated struct IslandShellGeometry: VectorArithmetic {
  private var values: SIMD8<Double>

  init(layout: IslandMetrics.ShellCardLayout) {
    values = SIMD8(
      layout.size.width, layout.size.height, layout.media.width, layout.media.height,
      layout.notesHeight, layout.answerSlotHeight, layout.quickAsksHeight, layout.contentHeight)
  }

  private init(_ values: SIMD8<Double>) { self.values = values }

  var width: Double { max(values[0], 1) }
  var height: Double { max(values[1], 1) }
  var size: WindowSize { WindowSize(width: width, height: height) }
  /// The player, or the long screenshot's preview box.
  var media: WindowSize { WindowSize(width: max(values[2], 1), height: max(values[3], 1)) }
  var notesHeight: Double { max(values[4], 0) }
  var answerSlotHeight: Double { max(values[5], 0) }
  var quickAsksHeight: Double { max(values[6], 0) }
  var contentHeight: Double { max(values[7], 0) }

  static var zero: Self { Self(.zero) }
  static func + (lhs: Self, rhs: Self) -> Self { Self(lhs.values + rhs.values) }
  static func - (lhs: Self, rhs: Self) -> Self { Self(lhs.values - rhs.values) }
  mutating func scale(by rhs: Double) { values *= rhs }
  var magnitudeSquared: Double { (values * values).sum() }
}
