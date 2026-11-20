import AtdModel
import SwiftUI

/// A command's identity in the share sheet: its symbol on a rounded square in its system hue.
struct CommandTile: View {
  let command: Command
  var size: CGFloat = 32

  var body: some View {
    Image(systemName: command.symbol)
      .font(.system(size: size * 0.5, weight: .semibold))
      .foregroundStyle(command.tint.glyph)
      .frame(width: size, height: size)
      .background(command.tint.color, in: .rect(cornerRadius: size * 0.27, style: .continuous))
      .accessibilityHidden(true)
  }
}

extension CommandTint {
  /// The system hue it names.
  var color: Color {
    switch self {
    case .red: .red
    case .orange: .orange
    case .yellow: .yellow
    case .green: .green
    case .mint: .mint
    case .teal: .teal
    case .cyan: .cyan
    case .blue: .blue
    case .indigo: .indigo
    case .purple: .purple
    case .pink: .pink
    case .brown: .brown
    case .gray: .gray
    }
  }

  /// Black on the light hues, white on the dark ones, for legible glyphs.
  var glyph: Color {
    switch self {
    case .yellow, .orange, .green, .mint, .teal, .cyan: .black
    default: .white
    }
  }
}

/// An option's choices: a segmented control, or a menu at accessibility text sizes, where the
/// segments would not fit.
struct OptionPicker: View {
  let option: CommandOption
  let selection: String
  let select: (String) -> Void

  @Environment(\.dynamicTypeSize) private var typeSize

  var body: some View {
    let binding = Binding(get: { selection }, set: { select($0) })
    if typeSize.isAccessibilitySize {
      Picker(option.label, selection: binding) { choices }
        .pickerStyle(.menu)
    } else {
      Picker(option.label, selection: binding) { choices }
        .pickerStyle(.segmented)
        .labelsHidden()
    }
  }

  private var choices: some View {
    ForEach(option.choices, id: \.self) { Text($0).tag($0) }
  }
}

/// The bottom of a run's screen: its actions, full width, the first prominent.
struct ActionBar<Content: View>: View {
  @ViewBuilder let content: Content

  var body: some View {
    VStack(spacing: 10) { content }
      .buttonBorderShape(.capsule)
      .controlSize(.large)
      .padding(.horizontal, 20)
      .padding(.bottom, 8)
  }
}

/// The prominent action of a screen.
struct PrimaryButton: View {
  let title: String
  let symbol: String
  var isBusy = false
  let action: () -> Void

  var body: some View {
    Button(action: action) {
      ZStack {
        Label {
          Text(title)
        } icon: {
          Image(systemName: symbol)
        }
        .opacity(isBusy ? 0 : 1)
        if isBusy { ProgressView() }
      }
      .frame(maxWidth: .infinity)
    }
    .buttonStyle(.glassProminent)
    .tint(.primary)
    .disabled(isBusy)
  }
}

/// A secondary action, or the only one where the prominent action cannot happen.
struct SecondaryButton: View {
  let title: String
  let symbol: String
  let action: () -> Void

  var body: some View {
    Button(action: action) {
      Label {
        Text(title)
      } icon: {
        Image(systemName: symbol)
      }
      .frame(maxWidth: .infinity)
    }
    .buttonStyle(.bordered)
  }
}

/// Copies a result; it says so once it has.
struct CopyButton: View {
  enum Kind {
    case result, translation, event, notes, todos
  }

  let copied: Bool
  let kind: Kind
  var isProminent = true
  let action: () -> Void

  var body: some View {
    let symbol = copied ? "checkmark" : "doc.on.doc"
    if isProminent {
      PrimaryButton(title: title, symbol: symbol, action: action)
    } else {
      SecondaryButton(title: title, symbol: symbol, action: action)
    }
  }

  private var title: String {
    switch (kind, copied) {
    case (.result, false): String(localized: "copy.result", bundle: .module)
    case (.result, true): String(localized: "copied.result", bundle: .module)
    case (.translation, false): String(localized: "copy.translation", bundle: .module)
    case (.translation, true): String(localized: "copied.translation", bundle: .module)
    case (.event, false): String(localized: "copy.event", bundle: .module)
    case (.event, true): String(localized: "copied.event", bundle: .module)
    case (.notes, false): String(localized: "copy.notes", bundle: .module)
    case (.notes, true): String(localized: "copied.notes", bundle: .module)
    case (.todos, false): String(localized: "copy.todos", bundle: .module)
    case (.todos, true): String(localized: "copied.todos", bundle: .module)
    }
  }
}

/// A screen with nothing to run: why, in one line.
struct ShareMessage: View {
  let symbol: String
  let text: String

  var body: some View {
    ContentUnavailableView {
      Label {
        Text(text)
      } icon: {
        Image(systemName: symbol)
      }
    }
  }
}
