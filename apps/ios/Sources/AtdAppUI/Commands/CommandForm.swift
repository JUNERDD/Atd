import AtdModel
import SwiftUI

/// The command editor, on the sheet's paper like a note: the sticker and the name head it, then
/// the 要求, the options, where it shows up, what it reads and does, and a trial run. Used by a
/// command's sheet and by the review step of a new command.
struct CommandForm: View {
  @Binding var command: Command
  @FocusState private var focus: Field?

  private enum Field {
    case name, instructions
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      HStack(spacing: 12) {
        Sticker(symbol: command.symbol, tint: command.tint, seed: command.id, size: 38)
        TextField(AppText.string("command.name.placeholder"), text: $command.name)
          .font(.title2.bold())
          .submitLabel(.done)
          .focused($focus, equals: .name)
          .accessibilityLabel(AppText.string("command.name"))
      }
      .padding(.horizontal, 20)
      .frame(minHeight: 60)

      SectionHeader(AppText.string("command.instructions"))
      TextField("", text: $command.instructions, axis: .vertical)
        .lineLimit(3...10)
        .lineSpacing(3)
        .focused($focus, equals: .instructions)
        .inkField(focused: focus == .instructions)
        .padding(.horizontal, 16)
        .padding(.top, 6)
        .accessibilityLabel(AppText.string("command.instructions"))

      if !command.options.isEmpty {
        SectionHeader(AppText.string("command.options"))
        InkList {
          ForEach($command.options, id: \.key) { $option in
            VStack(alignment: .leading, spacing: 8) {
              Text(option.label)
                .font(.subheadline)
                .foregroundStyle(.secondary)
              InkSegmented(label: option.label, choices: option.choices, selection: $option.value)
            }
            .padding(.horizontal, 20)
            .padding(.top, 12)
            .padding(.bottom, 10)
          }
        }
      }

      SectionHeader(AppText.string("command.surfaces"))
      InkList {
        ForEach(Surface.available, id: \.self) { surface in
          Toggle(surface.label, isOn: $command.placement[surface])
            .toggleStyle(InkToggleStyle())
            .padding(.horizontal, 20)
        }
      }

      InkList {
        ValueRow(title: AppText.string("command.reads"), value: command.input.label)
        ValueRow(title: AppText.string("command.result"), value: command.output.action.label)
        Toggle(AppText.string("command.review"), isOn: $command.output.review)
          .toggleStyle(InkToggleStyle())
          .padding(.horizontal, 20)
      }
      .padding(.top, 34)

      TrialCard(command: command)
        .padding(.horizontal, 16)
        .padding(.top, 34)
    }
    .padding(.bottom, 16)
  }
}

/// A row that shows a value it does not let you change.
private struct ValueRow: View {
  let title: String
  let value: String

  var body: some View {
    HStack(spacing: 12) {
      Text(title)
      Spacer(minLength: 8)
      Text(value)
        .foregroundStyle(.secondary)
        .lineLimit(1)
    }
    .padding(.horizontal, 20)
    .frame(minHeight: 44)
    .accessibilityElement(children: .combine)
  }
}
