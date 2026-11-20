import SwiftUI

/// A button inked by hand on the paper: `bordered` is an outline, `filled` is solid ink (the one
/// primary action of a screen). Each form keeps a 44-point hit area around what it draws.
struct InkButtonStyle: ButtonStyle {
  enum Kind {
    case bordered, filled
  }

  enum Form {
    /// A capsule that hugs its label, 36 points tall.
    case capsule
    /// A round icon button, 40 points across.
    case round
    /// A full-width button, 48 points tall.
    case block
  }

  var kind: Kind = .bordered
  var form: Form = .capsule

  func makeBody(configuration: Configuration) -> some View {
    InkButton(configuration: configuration, kind: kind, form: form)
  }
}

private struct InkButton: View {
  let configuration: ButtonStyleConfiguration
  let kind: InkButtonStyle.Kind
  let form: InkButtonStyle.Form
  @Environment(\.isEnabled) private var isEnabled

  var body: some View {
    let pressed = configuration.isPressed
    let shape = InkShape(corners: corners, seed: seed)
    configuration.label
      .font(form == .block ? .body.weight(.semibold) : .subheadline.weight(.semibold))
      .labelStyle(InkLabelStyle())
      .foregroundStyle(kind == .filled ? InkColor.paper : Color.primary)
      .lineLimit(1)
      .padding(.horizontal, form == .round ? 0 : form == .block ? 20 : 14)
      .frame(
        minWidth: form == .round ? 40 : nil, maxWidth: form == .block ? .infinity : nil,
        minHeight: form == .block ? 48 : form == .round ? 40 : 36
      )
      .background {
        ZStack {
          shape.fill(fill(pressed: pressed))
          if kind == .bordered { shape.stroke(InkColor.line, lineWidth: 1.1) }
        }
        .offset(x: pressed ? 1 : 0, y: pressed ? 1.5 : 0)
      }
      .padding(.vertical, form == .block ? 0 : form == .round ? 2 : 4)
      .padding(.horizontal, form == .round ? 2 : 0)
      .contentShape(Rectangle())
      .opacity(isEnabled ? 1 : 0.4)
  }

  private var corners: InkCorners {
    switch form {
    case .capsule: .capsule
    case .round: .round
    case .block: .block
    }
  }

  private var seed: Int {
    switch form {
    case .capsule: 17
    case .round: 23
    case .block: 31
    }
  }

  private func fill(pressed: Bool) -> Color {
    switch kind {
    case .filled: pressed ? Color.primary.opacity(0.78) : Color.primary
    case .bordered: pressed ? InkColor.press : InkColor.paper
    }
  }
}

/// Icon and title close together, the icon a little smaller than the title.
private struct InkLabelStyle: LabelStyle {
  func makeBody(configuration: Configuration) -> some View {
    HStack(spacing: 5) {
      configuration.icon.imageScale(.medium)
      configuration.title
    }
  }
}

/// A switch inked on the paper: a hand-drawn pill whose track fills with green highlighter when it
/// is on. VoiceOver reads it as the system switch it stands for.
struct InkToggleStyle: ToggleStyle {
  func makeBody(configuration: Configuration) -> some View {
    InkSwitch(configuration: configuration)
  }
}

private struct InkSwitch: View {
  let configuration: ToggleStyleConfiguration
  @Environment(\.isEnabled) private var isEnabled
  @Environment(\.accessibilityReduceMotion) private var reduceMotion

  var body: some View {
    Button {
      withAnimation(reduceMotion ? nil : .snappy(duration: 0.22)) {
        configuration.isOn.toggle()
      }
    } label: {
      HStack(spacing: 12) {
        configuration.label
          .frame(maxWidth: .infinity, alignment: .leading)
        track
      }
      // Room above and below the label once large text makes it taller than the track.
      .padding(.vertical, 6)
      .frame(minHeight: 44)
      .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
    .accessibilityRepresentation {
      Toggle(isOn: configuration.$isOn) { configuration.label }
    }
  }

  private var track: some View {
    let shape = InkShape(corners: .track, wobble: 0.6, seed: 3)
    return ZStack(alignment: configuration.isOn ? .trailing : .leading) {
      shape.fill(configuration.isOn ? InkColor.on : InkColor.paper)
      shape.stroke(InkColor.line, lineWidth: 1.1)
      Circle()
        .fill(InkColor.paper)
        .overlay(Circle().stroke(InkColor.line, lineWidth: 1.1))
        .shadow(color: .black.opacity(0.12), radius: 1, y: 1)
        .frame(width: 22, height: 22)
        .padding(4)
    }
    .frame(width: 52, height: 30)
    .opacity(isEnabled ? 1 : 0.45)
  }
}

/// One choice among a few, side by side in an inked frame; the chosen one is marked with yellow
/// highlighter. The choices stack in a column when they do not fit side by side.
struct InkSegmented: View {
  let label: String
  let choices: [String]
  @Binding var selection: String
  @Namespace private var marker
  @Environment(\.accessibilityReduceMotion) private var reduceMotion

  var body: some View {
    ViewThatFits(in: .horizontal) {
      segments(HStackLayout(spacing: 0))
      segments(VStackLayout(spacing: 0))
    }
    .animation(reduceMotion ? nil : .snappy(duration: 0.22), value: selection)
    .accessibilityElement(children: .contain)
    .accessibilityLabel(label)
  }

  private func segments(_ layout: some Layout) -> some View {
    layout {
      ForEach(choices, id: \.self) { choice in
        let chosen = choice == selection
        Button {
          selection = choice
        } label: {
          Text(choice)
            .font(.subheadline.weight(chosen ? .semibold : .regular))
            .lineLimit(1)
            .fixedSize()
            .padding(.horizontal, 12)
            .frame(maxWidth: .infinity, minHeight: 36)
            .background {
              if chosen {
                InkShape(corners: .segment, wobble: 0.6, seed: 5)
                  .fill(InkColor.chosen)
                  .padding(4)
                  .matchedGeometryEffect(id: "chosen", in: marker)
              }
            }
            .contentShape(Rectangle().inset(by: -4))
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(chosen ? .isSelected : [])
      }
    }
    .background {
      let frame = InkShape(corners: .segments, seed: 9)
      frame.fill(InkColor.paper)
      frame.stroke(InkColor.line, lineWidth: 1.1)
    }
    .padding(.vertical, 4)
  }
}

extension View {
  /// Frames a text field or editor by hand; the edge turns to ink while it has focus.
  func inkField(focused: Bool = false) -> some View {
    padding(.horizontal, 12)
      .padding(.vertical, 10)
      .background {
        let frame = InkShape(corners: .field, seed: 11)
        frame.fill(InkColor.paper)
        frame.stroke(focused ? Color.primary : InkColor.line, lineWidth: 1.1)
      }
  }

  /// A block that groups its own content, outlined by hand: no fill of its own and no shadow.
  func inkCard(seed: Int = 0) -> some View {
    background {
      InkShape(corners: .card, seed: seed).stroke(InkColor.cardLine, lineWidth: 1)
    }
  }
}
