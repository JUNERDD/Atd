import AtdInk
import AtdModel
import SwiftUI

/// The command editor, on the sheet's paper like a note: its name, the 要求, the options, the entry
/// points that can run it, what it reads and does, the model it runs on, and a trial run. The
/// sheet's header carries the title, so the name here is a field like the 要求. Used by a
/// command's sheet and by the review step of a new command.
struct CommandForm: View {
  @Binding var command: Command
  @FocusState private var focus: Field?

  private enum Field {
    case name, instructions
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      SectionHeader(AppText.string("command.name"))
      TextField(AppText.string("command.name.placeholder"), text: $command.name)
        .submitLabel(.done)
        .focused($focus, equals: .name)
        .inkField(focused: focus == .name)
        .padding(.horizontal, 16)
        .padding(.top, 6)
        .accessibilityLabel(AppText.string("command.name"))

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
        ForEach(offered, id: \.self) { surface in
          Toggle(surface.label, isOn: $command.placement[surface])
            .toggleStyle(InkToggleStyle())
            .padding(.horizontal, 20)
        }
      }
      if command.placement.controls {
        // Turning the switch on is not enough: the person adds Atd's control in the system.
        SectionFooter(AppText.string("surface.controls.footer"))
      }

      InkList {
        ValueRow(title: AppText.string("command.reads"), value: command.input.label)
        ValueRow(title: AppText.string("command.result"), value: command.output.action.label)
        Toggle(AppText.string("command.review"), isOn: $command.output.review)
          .toggleStyle(InkToggleStyle())
          .padding(.horizontal, 20)
        ModelRow(choice: $command.model)
      }
      .padding(.top, 34)

      TrialCard(command: command)
        .padding(.horizontal, 16)
        .padding(.top, 34)
    }
    .padding(.bottom, 16)
  }

  /// The entry points the command can be placed in: those that can run it, and any it is placed
  /// in anyway (by an older library), so that switch can still be turned off.
  private var offered: [Surface] {
    Surface.available.filter { command.runs(on: $0) || command.placement[$0] }
  }
}

/// A row that shows a value it does not let you change; the value moves under the title when
/// large text leaves no room beside it.
private struct ValueRow: View {
  let title: String
  let value: String

  var body: some View {
    ViewThatFits(in: .horizontal) {
      HStack(spacing: 12) {
        Text(title)
        Spacer(minLength: 8)
        Text(value)
          .foregroundStyle(.secondary)
          .fixedSize()
      }
      VStack(alignment: .leading, spacing: 2) {
        Text(title)
        Text(value).foregroundStyle(.secondary)
      }
      .frame(maxWidth: .infinity, alignment: .leading)
    }
    .padding(.horizontal, 20)
    .padding(.vertical, 6)
    .frame(minHeight: 44)
    .accessibilityElement(children: .combine)
  }
}
