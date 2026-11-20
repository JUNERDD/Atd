import AppIntents
import AtdInk
import AtdIntents
import AtdModel
import SwiftUI
import WidgetKit

/// 常用指令's face: four hand-framed buttons in a 2 × 2 grid, under Atd's name in the medium size.
/// Each shows its command's sticker in full color; where the system tints the Home Screen, only
/// the sticker's glyph and the frame's line remain.
struct CommandsWidgetView: View {
  let family: WidgetFamily

  /// Text follows Dynamic Type up to this size; larger, the names no longer fit their buttons.
  static let largestType = DynamicTypeSize.xLarge

  var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      if family != .systemSmall {
        header
      }
      Grid(horizontalSpacing: 8, verticalSpacing: 8) {
        GridRow {
          CommandsWidgetCell(button: .camera, compact: family == .systemSmall)
          CommandsWidgetCell(button: .ask, compact: family == .systemSmall)
        }
        GridRow {
          CommandsWidgetCell(button: .expense, compact: family == .systemSmall)
          CommandsWidgetCell(button: .briefing, compact: family == .systemSmall)
        }
      }
    }
    .dynamicTypeSize(...Self.largestType)
    .accessibilityElement(children: .contain)
    .accessibilityLabel(Text(EntryCopy.string("commands.name")))
  }

  private var header: some View {
    HStack(spacing: 6) {
      Image(uiImage: InkArt.markImage(side: 20))
        .widgetAccentable()
        .accessibilityHidden(true)
      Text(verbatim: "Atd")
        .font(.footnote.weight(.semibold))
      Spacer(minLength: 4)
      Text(EntryCopy.string("commands.name"))
        .font(.caption.weight(.medium))
        .foregroundStyle(.secondary)
    }
    .accessibilityHidden(true)
  }
}

/// One of 常用指令's buttons.
enum CommandsWidgetButton: CaseIterable {
  case camera, ask, expense, briefing

  var label: String {
    switch self {
    case .camera: EntryCopy.string("widget.camera")
    case .ask: EntryCopy.string("widget.ask")
    case .expense: EntryCopy.string("widget.expense")
    case .briefing: EntryCopy.string("briefing.name")
    }
  }

  var symbol: String {
    switch self {
    case .camera: "camera"
    case .ask: "waveform"
    case .expense: "receipt"
    case .briefing: "sunrise"
    }
  }

  var tint: CommandTint {
    switch self {
    case .camera: .gray
    case .ask: .indigo
    case .expense: .orange
    case .briefing: .yellow
    }
  }

  /// What the button opens in Atd; nil for 今日简报, which runs where it is and answers in its
  /// Live Activity.
  var route: AtdRoute? {
    switch self {
    case .camera: .camera(commandID: nil)
    case .ask: .ask(text: nil)
    case .expense: .camera(commandID: BuiltinCommands.expenseID)
    case .briefing: nil
    }
  }
}

/// A button of 常用指令: a link into Atd, or 今日简报's intent, which runs without opening it.
struct CommandsWidgetCell: View {
  let button: CommandsWidgetButton
  /// The small size stacks the label under the sticker.
  let compact: Bool

  var body: some View {
    if let url = button.route?.url() {
      Link(destination: url) { face }
    } else {
      Button(intent: BriefingIntent()) { face }
        .buttonStyle(.plain)
    }
  }

  private var face: some View {
    layout {
      CommandsWidgetSticker(button: button, size: compact ? 26 : 28)
      Text(button.label)
        .font(compact ? .caption.weight(.semibold) : .subheadline.weight(.semibold))
        .lineLimit(compact ? 2 : 1)
        .minimumScaleFactor(0.7)
        .multilineTextAlignment(compact ? .center : .leading)
    }
    .padding(.horizontal, compact ? 4 : 10)
    .padding(.vertical, compact ? 4 : 0)
    .frame(maxWidth: .infinity, minHeight: 44, maxHeight: .infinity, alignment: frameAlignment)
    .contentShape(Self.frame)
    .background {
      Self.frame.stroke(InkColor.line, lineWidth: 1.1)
    }
    .accessibilityElement(children: .ignore)
    .accessibilityLabel(Text(button.label))
    .accessibilityAddTraits(.isButton)
  }

  private var layout: AnyLayout {
    compact
      ? AnyLayout(VStackLayout(spacing: 4)) : AnyLayout(HStackLayout(spacing: 8))
  }

  private var frameAlignment: Alignment {
    compact ? .center : .leading
  }

  /// The prototype's hand-drawn button edge (`awc__btn`).
  private static let frame = InkShape(corners: InkCorners([17, 13, 18, 12], [13, 18, 12, 17]))
}

/// A button's sticker in full color; in the tinted modes the highlighter would turn into a solid
/// block, so only the glyph stays, in the accent the system picks.
private struct CommandsWidgetSticker: View {
  let button: CommandsWidgetButton
  let size: CGFloat
  @Environment(\.widgetRenderingMode) private var renderingMode

  var body: some View {
    if renderingMode == .fullColor {
      Sticker(symbol: button.symbol, tint: button.tint, seed: "\(button)", size: size)
    } else {
      Image(systemName: button.symbol)
        .font(.system(size: size * 0.6, weight: .medium))
        .frame(width: size, height: size)
        .widgetAccentable()
        .accessibilityHidden(true)
    }
  }
}
