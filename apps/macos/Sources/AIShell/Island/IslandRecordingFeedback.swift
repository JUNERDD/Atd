import AICore
import Observation
import SwiftUI

/// What a shell card's footer actions (the recording's Save, Copy, Attach; the long
/// screenshot's Annotate, Copy, Attach) report on their own buttons
/// (``IslandRecording/cardFeedback(_:_:)``, ``IslandLongScreenshot/cardFeedback(_:_:)``), so the
/// card stays on the island while they run: a spinner while one runs, then its message, which
/// gives way to the button's label after ``IslandShellFeedbackTiming/duration``. A newer report
/// for the same action replaces the one before and its timer.
@Observable
final class IslandShellFeedback<Action: Hashable> {
  private(set) var states: [Action: IslandRecording.CardFeedback] = [:]
  @ObservationIgnored private var tokens: [Action: Int] = [:]

  // Avoid Swift 6.2.4's optimized generic main-actor deinit crash, as with IslandPlainHost.
  deinit {}

  func show(_ feedback: IslandRecording.CardFeedback, for action: Action) {
    states[action] = feedback
    let token = (tokens[action] ?? 0) + 1
    tokens[action] = token
    guard feedback != .working else { return }
    Task { [weak self] in
      try? await Task.sleep(for: IslandShellFeedbackTiming.duration)
      guard let self, tokens[action] == token else { return }
      states[action] = nil
    }
  }
}

enum IslandShellFeedbackTiming {
  /// How long a done or failed message stays on its button.
  static let duration: Duration = .seconds(2)
}

/// A footer button that reports its action in place, drawn as the command result cards'
/// buttons are (``IslandTextFace``): at rest its label, and its shortcut's keycap when it has
/// one; a spinner in the same room while the action runs, the button disabled; then the
/// action's message after a check or warning. The active message participates in layout, with
/// the resting label as a minimum. Where the complete row cannot fit, the footer compacts a
/// secondary action to its glyph in a round button, as the result cards' compact actions are
/// (``IslandIconButton``), and a primary one drops its keycap. Full details remain in the
/// tooltip and accessibility value in every layout.
struct IslandFeedbackButton: View {
  let title: String
  /// What a compacted secondary action shows in place of its label; without one it keeps it.
  let glyph: String?
  let workingLabel: String
  var tooltip: String?
  /// The shortcut that performs the action too (``IslandShellFooterKey``), shown as a keycap.
  var keys: String?
  var primary = false
  var compact = false
  /// The glyph leads the label at rest too, for an action that enters a mode the capture toolbar
  /// also names with its glyph (the long screenshot's Select Text).
  var glyphAtRest = false
  let feedback: IslandRecording.CardFeedback?
  let action: () -> Void
  @State private var hovered = false
  @Environment(\.isEnabled) private var isEnabled

  /// A secondary action compacted to its glyph.
  private var iconOnly: Bool { compact && !primary && glyph != nil }

  var body: some View {
    let message = feedback.flatMap(Self.message)
    let working = feedback == .working
    let described = [tooltip ?? title, keys].compactMap { $0 }.joined(separator: " ")
    Button(action: action) {
      ZStack {
        rest.hidden().accessibilityHidden(true)
        switch feedback {
        case nil: rest
        case .working: IslandRecordingOutcomeGlyph(outcome: nil, side: 14)
        case .done(let text): report(compact ? title : text, outcome: .done)
        case .failed(let text): report(compact ? title : text, outcome: .failed)
        }
      }
      .fixedSize()
    }
    // The command result cards' actions: the primary one rests on the wash, as Copy does there.
    .buttonStyle(
      IslandWashStyle(shape: Capsule(), hovered: hovered && !working, rest: primary ? 0.08 : 0)
    )
    .disabled(working)
    .modifier(FloatingHover(enabled: isEnabled && !working) { hovered = $0 })
    .help(working ? workingLabel : message ?? described)
    .accessibilityLabel(Text(verbatim: title))
    .accessibilityValue(Text(verbatim: working ? workingLabel : message ?? ""))
  }

  /// The button at rest: its label and keycap, or a compacted secondary action's glyph.
  @ViewBuilder private var rest: some View {
    if iconOnly, let glyph {
      IslandGlyph(name: glyph)
        .frame(width: IslandMetrics.controlSide, height: IslandMetrics.controlSide)
    } else {
      IslandTextFace(title: title, keys: compact ? nil : keys, glyph: glyphAtRest ? glyph : nil)
    }
  }

  /// A finished action's check or warning, with `text` unless the action is compacted to its
  /// glyph.
  private func report(_ text: String, outcome: IslandRecording.StatusKind) -> some View {
    HStack(spacing: 6) {
      IslandRecordingOutcomeGlyph(outcome: outcome, side: 14)
      if !iconOnly { Text(verbatim: text).font(IslandType.label).lineLimit(1) }
    }
    .padding(.horizontal, iconOnly ? 0 : 10)
    .frame(height: IslandMetrics.controlSide)
  }

  private static func message(_ feedback: IslandRecording.CardFeedback) -> String? {
    switch feedback {
    case .working: nil
    case .done(let text), .failed(let text): text
    }
  }
}

/// How something of the recording stands on the island: a spinner while it runs (nil), a check
/// once it is done, a warning when it could not be done.
struct IslandRecordingOutcomeGlyph: View {
  let outcome: IslandRecording.StatusKind?
  var side = IslandMetrics.glyphSide

  var body: some View {
    switch outcome {
    case nil: IslandSpinner(side: side)
    case .done: IslandGlyph(name: "check", side: side)
    case .failed: IslandGlyph(name: IslandIcons.warning, side: side)
    }
  }
}
