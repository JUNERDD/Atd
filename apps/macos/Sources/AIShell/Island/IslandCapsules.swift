import AICore
import AppKit
import SwiftUI

/// The island's capsule contents, each 44 pt tall (a 32 pt control in 6 pt of padding) and as
/// wide as it needs to be; ``IslandController`` measures them to size the shape. Command names
/// and the values summary are user data, shown untranslated and cut with an ellipsis.
struct IslandCapsule: View {
  let model: IslandModel
  let content: IslandContent
  /// How wide its texts may grow: narrower than their defaults when the capsule would be wider
  /// than the island's largest shape (``IslandMetrics/CapsuleLimits``).
  var limits = IslandMetrics.CapsuleLimits()

  var body: some View {
    Group {
      switch content {
      case .press(let command): press(command)
      case .working(let command, let summary):
        IslandWorking(model: model, command: command, summary: summary, limits: limits)
      case .writing: status(model.labels.writing, running: true)
      case .done: status(model.labels.done, running: false)
      case .copied: status(model.labels.copied, running: false)
      case .notice(let message): notice(message)
      case .choose, .answer: EmptyView()
      }
    }
    .frame(height: IslandMetrics.capsuleHeight)
  }

  /// The command's name, the charge meter and what holding on does.
  private func press(_ command: String) -> some View {
    HStack(spacing: 10) {
      name(command)
      IslandMeter()
      Text(verbatim: model.labels.holdHint)
        .font(IslandType.hint)
        .foregroundStyle(.secondary)
        .lineLimit(1)
        .fixedSize()
    }
    // As the HUD's status-only capsule: 8 pt in, 10 pt out, inside the bar's padding.
    .padding(.leading, IslandMetrics.padding + 8)
    .padding(.trailing, IslandMetrics.padding + 10)
    .accessibilityElement(children: .ignore)
    .accessibilityLabel(Text(verbatim: command + ", " + model.labels.holdHint))
  }

  /// Writing, with the activity indicator, or written (or copied), with a check.
  private func status(_ text: String, running: Bool) -> some View {
    HStack(spacing: 8) {
      if running {
        IslandSpinner()
      } else {
        IslandGlyph(name: "check")
      }
      Text(verbatim: text).font(IslandType.label).lineLimit(1).fixedSize()
    }
    // As the HUD's status-only capsule: 8 pt in, 10 pt out, inside the bar's padding.
    .padding(.leading, IslandMetrics.padding + 8)
    .padding(.trailing, IslandMetrics.padding + 10)
    .accessibilityElement(children: .ignore)
    .accessibilityLabel(Text(verbatim: text))
  }

  /// The app's mark, the page's message, Open and a close button that only dismisses.
  /// Laid out as the HUD's notice was: the mark and the message 8 pt in, then Open and close,
  /// the toolbar's 2 pt apart.
  private func notice(_ message: String) -> some View {
    HStack(spacing: IslandMetrics.gap) {
      HStack(spacing: 6) {
        Image(nsImage: Self.mark)
          .renderingMode(.template)
          .resizable()
          .frame(width: IslandMetrics.glyphSide, height: IslandMetrics.glyphSide)
          .accessibilityHidden(true)
        noticeText(message)
      }
      .padding(.leading, 8)
      .padding(.trailing, 6)
      IslandTextButton(title: model.labels.open, tooltip: model.labels.openTooltip) {
        model.act(.open)
      }
      IslandIconButton(glyph: AnnotationIcons.cancel, label: model.labels.dismiss) {
        model.act(.dismiss)
      }
    }
    .padding(.horizontal, IslandMetrics.padding)
    .accessibilityElement(children: .contain)
    .accessibilityLabel(Text(verbatim: message))
  }

  private func noticeText(_ message: String) -> some View {
    Text(verbatim: message)
      .font(IslandType.label)
      .lineLimit(IslandMetrics.maxMessageLines)
      .truncationMode(.tail)
      .frame(
        width: IslandType.width(of: message, limit: limits.message),
        alignment: .leading
      )
      .fixedSize(horizontal: false, vertical: true)
      .help(message)
  }

  private func name(_ command: String) -> some View {
    Text(verbatim: command)
      .font(IslandType.label)
      .lineLimit(1)
      .truncationMode(.tail)
      .frame(width: IslandType.width(of: command, limit: limits.command))
  }

  /// The menu bar's template mark.
  private static let mark: NSImage = {
    let image = (NSImage(named: "idleTemplate")?.copy() as? NSImage) ?? NSImage()
    image.isTemplate = true
    return image
  }()
}

/// The working capsule: the grip, the activity indicator, the command's name shimmering, the
/// values chip when the run has options (a click stops the run and reopens its options card),
/// the hint that Escape cancels, and a close button that cancels.
private struct IslandWorking: View {
  let model: IslandModel
  let command: String
  let summary: String?
  let limits: IslandMetrics.CapsuleLimits

  var body: some View {
    let labels = model.labels
    // The HUD's row: the grip, the status and the hint (2 pt in, 4 pt before the close
    // button, 12 pt apart, the spinner 6 pt before the name), the close button, the toolbar's
    // 2 pt between items in its 4 pt of padding. The values chip is the island's own.
    HStack(spacing: IslandMetrics.gap) {
      IslandGrip(model: model)
      HStack(spacing: 12) {
        HStack(spacing: 6) {
          IslandSpinner()
          IslandShimmer(text: command)
            .frame(width: IslandShimmer.width(of: command, limit: limits.command))
        }
        if let summary {
          IslandChip(summary: summary, limit: limits.summary, label: labels.change) {
            model.act(.change)
          }
        }
        IslandHint(template: labels.escapeHint, keys: ["Esc"])
      }
      .padding(.leading, 2)
      .padding(.trailing, 4)
      IslandIconButton(glyph: AnnotationIcons.cancel, label: labels.cancel) { model.act(.cancel) }
    }
    .padding(.horizontal, IslandMetrics.padding)
    .accessibilityElement(children: .contain)
    .accessibilityLabel(Text(verbatim: labels.working(command)))
  }
}

/// The values a run goes with, on a small capsule: a click changes them.
private struct IslandChip: View {
  let summary: String
  let limit: Double
  let label: String
  let action: () -> Void
  @State private var hovered = false

  var body: some View {
    Button(action: action) {
      Text(verbatim: summary)
        .font(IslandType.hint.weight(.medium))
        .foregroundStyle(.secondary)
        .lineLimit(1)
        .truncationMode(.tail)
        .frame(
          width: IslandType.width(
            of: summary, size: 12, limit: limit)
        )
        .padding(.horizontal, 8)
        .frame(height: 22)
    }
    .buttonStyle(IslandWashStyle(shape: Capsule(), hovered: hovered, rest: 0.08))
    .onHover { hovered = $0 }
    .pointerStyle(.link)
    .help(label)
    .accessibilityLabel(Text(verbatim: label))
    .accessibilityValue(Text(verbatim: summary))
  }
}
