import SwiftUI

// How Atd shows a wait, the same way on every screen:
//
// - Content whose shape is known (a mini app's page, the card a photo becomes) shows that shape
//   at once, drawn with `InkPlaceholder` and grouped by `inkLoading(_:)`, which pulses it slowly.
// - Work whose result has no shape yet (an answer, a draft, a check) shows `InkWaiting` where the
//   result will appear: a spinner and what is happening.
// - An action that takes a moment keeps its spinner inside its button (`inkBusy(_:)`).
//
// Waits that are usually short show their indicator only after a moment, so a quick result never
// flashes one.

/// A shape standing in for content that is still on its way: a soft block of shade, rounded by
/// hand like the content it stands for.
public struct InkPlaceholder: View {
  public enum Form {
    /// A line of text, 12 points tall unless given a height.
    case line
    /// A button, a field or a picture.
    case block
    /// A sticker, a dot or a ring.
    case round
  }

  let form: Form
  let width: CGFloat?
  let height: CGFloat?
  let seed: Int

  /// - Parameter width: nil fills the width it is offered.
  public init(_ form: Form = .line, width: CGFloat? = nil, height: CGFloat? = nil, seed: Int = 0) {
    self.form = form
    self.width = width
    self.height = height
    self.seed = seed
  }

  public var body: some View {
    InkShape(corners: corners, wobble: 0.5, seed: seed)
      .fill(InkColor.shade)
      .frame(width: width, height: height ?? (form == .line ? 12 : width ?? 48))
      .frame(maxWidth: width == nil ? .infinity : nil, alignment: .leading)
      .accessibilityHidden(true)
  }

  private var corners: InkCorners {
    switch form {
    case .line: .chip
    case .block: .block
    case .round: .round
    }
  }
}

extension View {
  /// Makes placeholders one wait: VoiceOver reads `label` once instead of the shapes, and the
  /// shapes pulse slowly. Under Reduce Motion they hold still, which still reads as a wait.
  public func inkLoading(_ label: String) -> some View {
    modifier(InkLoadingPulse(label: label))
  }
}

private struct InkLoadingPulse: ViewModifier {
  let label: String
  @Environment(\.accessibilityReduceMotion) private var reduceMotion

  func body(content: Content) -> some View {
    Group {
      if reduceMotion {
        content
      } else {
        content.phaseAnimator([false, true]) { shapes, dim in
          shapes.opacity(dim ? 0.45 : 1)
        } animation: { _ in
          .easeInOut(duration: 0.9)
        }
      }
    }
    .accessibilityElement(children: .ignore)
    .accessibilityLabel(label)
  }
}

/// What is happening while the result takes shape, in the place it will appear: a spinner and a
/// line that names the work (正在想…, 正在测试…).
public struct InkWaiting: View {
  let label: String
  let delay: Duration
  @State private var shown: Bool

  /// - Parameter delay: for a wait that is usually short, how long it lasts before the line shows.
  ///   The line keeps its space meanwhile, so nothing moves when it appears.
  public init(_ label: String, delay: Duration = .zero) {
    self.label = label
    self.delay = delay
    _shown = State(initialValue: delay == .zero)
  }

  public var body: some View {
    HStack(spacing: 10) {
      ProgressView()
      Text(label)
        .foregroundStyle(.secondary)
    }
    .opacity(shown ? 1 : 0)
    .accessibilityElement(children: .combine)
    .accessibilityHidden(!shown)
    .task {
      guard !shown else { return }
      try? await Task.sleep(for: delay)
      guard !Task.isCancelled else { return }
      withAnimation(.easeOut(duration: 0.2)) { shown = true }
    }
  }
}

extension EnvironmentValues {
  /// Whether the inked buttons inside are doing what they were pressed for (`inkBusy(_:)`).
  @Entry var inkBusy = false
}

extension View {
  /// Puts a button into its busy look while `busy`: it takes no taps and, once the action has
  /// lasted a moment, shows a spinner in place of its label. It does not dim, since it is not
  /// unavailable, only working.
  public func inkBusy(_ busy: Bool) -> some View {
    environment(\.inkBusy, busy)
      .disabled(busy)
  }
}
