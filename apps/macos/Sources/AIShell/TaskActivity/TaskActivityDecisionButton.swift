import AICore
import AppKit
import SwiftUI

/// How a decision draws: a plain secondary label, the one prominent capsule of a request, or
/// the outlined capsule of a broader grant on the request's page.
enum TaskActivityButtonKind {
  case plain
  case prominent
  case bordered

  /// Disabled, a decision dims and keeps its tooltip.
  var disabledOpacity: Double {
    switch self {
    case .plain: 0.7
    case .prominent: 0.4
    case .bordered: 0.45
    }
  }
}

/// Which part of a capsule a control is: all of it, or one half of a split button.
enum TaskActivityCapsuleSide {
  case whole
  case leading
  case trailing

  var shape: UnevenRoundedRectangle {
    let radius = IslandMetrics.controlSide / 2
    return UnevenRoundedRectangle(
      topLeadingRadius: self == .trailing ? 0 : radius,
      bottomLeadingRadius: self == .trailing ? 0 : radius,
      bottomTrailingRadius: self == .leading ? 0 : radius,
      topTrailingRadius: self == .leading ? 0 : radius, style: .continuous)
  }
}

/// A decision. While its answer is on its way it stays put and, after 400 ms, shows a spinner
/// and a progressive label inside itself, with no minimum busy time; the task's other decisions
/// are disabled meanwhile by their callers. The default decision shows ↩ while the keyboard is
/// on its request; a pointer press never adds it, so the button keeps its width under a click.
struct TaskActivityDecisionButton: View {
  let title: String
  var tooltip: String?
  var kind = TaskActivityButtonKind.prominent
  var side = TaskActivityCapsuleSide.whole
  /// The label while this decision's answer is on its way; nil while it is not.
  var busy: String?
  var returnHint = false
  let action: () -> Void
  @State private var hovered = false
  @State private var progress = false
  @Environment(\.isEnabled) private var isEnabled

  private static let indicatorSide = 13.0

  var body: some View {
    Button(action: action) {
      HStack(spacing: 6) {
        if progress { IslandSpinner(side: Self.indicatorSide) }
        Text(verbatim: progress ? busy ?? title : title).font(IslandType.label).lineLimit(1)
        if returnHint && busy == nil {
          Text(verbatim: "↩").font(.system(size: 11, weight: .medium))
            .foregroundStyle(.secondary).accessibilityHidden(true)
        }
      }
      .padding(.leading, kind == .plain ? 4 : 10)
      .padding(.trailing, kind == .plain ? 4 : side == .leading ? 8 : 10)
      .frame(height: IslandMetrics.controlSide)
      .contentShape(side.shape)
    }
    .buttonStyle(TaskActivityDecisionStyle(kind: kind, side: side, hovered: hovered && isEnabled))
    .opacity(isEnabled || busy != nil ? 1 : kind.disabledOpacity)
    .allowsHitTesting(busy == nil)
    .onHover { hovered = $0 }
    .pointerStyle(isEnabled && busy == nil ? .link : nil)
    .help(tooltip ?? title)
    .accessibilityLabel(Text(verbatim: progress ? busy ?? title : title))
    .task(id: busy != nil) {
      progress = false
      guard busy != nil else { return }
      do { try await Task.sleep(for: .milliseconds(400)) } catch { return }
      progress = true
    }
  }
}

/// The decisions' washes: plain text that comes forward under the pointer and dims while
/// pressed; the prominent capsule's wash at rest, deeper on hover and press; the outlined
/// capsule's hairline with a wash only under the pointer.
struct TaskActivityDecisionStyle: ButtonStyle {
  let kind: TaskActivityButtonKind
  var side = TaskActivityCapsuleSide.whole
  let hovered: Bool

  func makeBody(configuration: Configuration) -> some View {
    let pressed = configuration.isPressed
    switch kind {
    case .plain:
      configuration.label
        .foregroundStyle(hovered ? Color.primary : Color.secondary)
        .opacity(pressed ? 0.55 : 1)
    case .prominent:
      configuration.label
        .foregroundStyle(.primary)
        .background {
          IslandWash(level: pressed ? 0.2 : hovered ? 0.13 : 0.08, shape: side.shape)
        }
    case .bordered:
      configuration.label
        .foregroundStyle(.primary)
        .background {
          IslandWash(level: pressed ? 0.12 : hovered ? 0.06 : 0, shape: side.shape)
            .overlay { side.shape.strokeBorder(Color.primary.opacity(0.2), lineWidth: 1) }
        }
    }
  }
}

/// One item of a control's pull-down menu.
struct TaskActivityMenuEntry {
  let title: String
  var tooltip: String?
  var enabled = true
  let action: () -> Void
}

/// A control that pulls down a native menu under itself: the split button's broader grants and
/// a waiting row's More actions. The menu is the system's, so it takes Escape and the keyboard
/// itself and reaches past the card's glass.
struct TaskActivityMenuButton: View {
  let glyph: String
  let label: String
  /// The trailing half of a split button; nil draws a round button of its own.
  var side: TaskActivityCapsuleSide?
  var glyphSide = 12.0
  let entries: () -> [TaskActivityMenuEntry]
  @State private var anchor = TaskActivityMenuAnchor()
  @State private var hovered = false
  @Environment(\.isEnabled) private var isEnabled

  var body: some View {
    let button = Button {
      anchor.popUp(entries())
    } label: {
      IslandGlyph(name: glyph, side: glyphSide)
        .frame(width: IslandMetrics.controlSide, height: IslandMetrics.controlSide)
    }
    Group {
      if let side {
        button.buttonStyle(
          TaskActivityDecisionStyle(kind: .prominent, side: side, hovered: hovered && isEnabled))
      } else {
        button.buttonStyle(IslandWashStyle(shape: Circle(), hovered: hovered))
          .foregroundStyle(.primary)
      }
    }
    .background { TaskActivityMenuAnchorView(anchor: anchor) }
    .onHover { hovered = $0 }
    .pointerStyle(isEnabled ? .link : nil)
    .help(label)
    .accessibilityLabel(Text(verbatim: label))
  }
}

/// Where a pulled-down menu hangs: the control's own AppKit view.
@MainActor
final class TaskActivityMenuAnchor {
  weak var view: NSView?

  func popUp(_ entries: [TaskActivityMenuEntry]) {
    guard let view, !entries.isEmpty else { return }
    let menu = NSMenu()
    menu.autoenablesItems = false
    for entry in entries {
      let item = ActionMenuItem(entry.title, entry.action)
      item.isEnabled = entry.enabled
      item.toolTip = entry.tooltip
      menu.addItem(item)
    }
    // Under the control, its trailing edge on the control's.
    let point = NSPoint(
      x: view.bounds.maxX - menu.size.width,
      y: view.isFlipped ? view.bounds.maxY + 4 : view.bounds.minY - 4)
    menu.popUp(positioning: nil, at: point, in: view)
  }
}

private struct TaskActivityMenuAnchorView: NSViewRepresentable {
  let anchor: TaskActivityMenuAnchor

  func makeNSView(context: Context) -> NSView {
    let view = NSView()
    anchor.view = view
    return view
  }

  func updateNSView(_ view: NSView, context: Context) {
    anchor.view = view
  }
}
