import AtdAI
import AtdInk
import AtdModel
import SwiftUI

/// Runs a command on a sample with the model it is set to, so a change to its 要求, options or
/// model can be tried before an entry point uses it: text it writes streams in, a card shows
/// what it holds. A built-in starts from its sample; a command that reads a photo takes one from
/// the photo picker. Nothing is written anywhere.
struct TrialCard: View {
  let command: Command
  @Environment(AppStore.self) private var store
  @State private var trial = TrialRun()
  @State private var text: String
  @State private var photo: TrialPhoto?
  @State private var addingModel = false

  init(command: Command) {
    self.command = command
    _text = State(initialValue: TrialSample.text(for: command))
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      input
      if trial.isRunning || trial.hasResult || trial.failure != nil {
        output
      }
      button
    }
    .padding(.horizontal, 16)
    .padding(.top, 14)
    .padding(.bottom, 16)
    .inkCard(seed: 4)
    .onDisappear { trial.stop() }
    .task {
      guard command.input == .image, photo == nil,
        let sample = await TrialSample.photo(for: command)
      else { return }
      photo = TrialPhoto(image: sample, isSample: true)
    }
    .sheet(isPresented: $addingModel) {
      ConnectionEditor(connection: nil)
    }
  }

  /// What the run reads, by the command's input.
  @ViewBuilder private var input: some View {
    switch command.input {
    case .text, .copied, .shared:
      VStack(alignment: .leading, spacing: 3) {
        Tag(AppText.string("trial.input"))
        TextField(AppText.string("trial.placeholder"), text: $text, axis: .vertical)
          .lineLimit(1...8)
          .lineSpacing(3)
          .accessibilityLabel(AppText.string("trial.input"))
      }
    case .image:
      VStack(alignment: .leading, spacing: 6) {
        Tag(AppText.string("trial.input"))
        TrialPhotoInput(photo: $photo)
      }
    case .none:
      if command.id == BuiltinCommands.briefingID {
        VStack(alignment: .leading, spacing: 3) {
          Tag(AppText.string("trial.input"))
          TrialAgendaInput()
        }
      }
    }
  }

  private var output: some View {
    VStack(alignment: .leading, spacing: 3) {
      Tag(AppText.string("trial.output"))
      if let failure = trial.failure {
        Text(failure).foregroundStyle(.secondary)
      } else if let card = trial.card {
        TrialCardContent(card: card, command: command)
      } else if trial.output.isEmpty {
        InkWaiting(AppText.string("trial.running"))
          .frame(minHeight: 22)
      } else {
        Text(trial.output)
          .lineSpacing(3)
          .textSelection(.enabled)
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .padding(.top, 12)
    .overlay(alignment: .top) { Divider() }
    .accessibilityElement(children: .combine)
  }

  @ViewBuilder private var button: some View {
    if !store.hasModel {
      Button {
        addingModel = true
      } label: {
        Label(AppText.string("models.add"), systemImage: "plus")
      }
      .buttonStyle(InkButtonStyle(form: .block))
    } else if trial.isRunning {
      Button {
        trial.stop()
      } label: {
        Label(AppText.string("trial.stop"), systemImage: "stop.fill")
      }
      .buttonStyle(InkButtonStyle(form: .block))
    } else {
      Button {
        trial.start(
          command, input: TrialRun.Input(text: text, photo: photo?.image), runner: store.runner
        ) {
          store.noteFailure($0, for: command.model)
        }
      } label: {
        Label(runTitle, systemImage: trial.hasRun ? "arrow.counterclockwise" : "play.fill")
      }
      .buttonStyle(InkButtonStyle(form: .block))
      .disabled(!canRun)
    }
  }

  /// Whether there is something to run on: text for a command that reads text, a photo for one
  /// that reads a photo.
  private var canRun: Bool {
    switch command.input {
    case .text, .copied, .shared: !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    case .image: photo != nil
    case .none: true
    }
  }

  /// 试运行, then 再试一次; after an option changed, the button itself says so.
  private var runTitle: String {
    guard let ranWith = trial.ranWith else { return AppText.string("trial.run") }
    return ranWith == command.values
      ? AppText.string("trial.again") : AppText.string("trial.newOptions")
  }
}

extension TrialRun {
  /// Whether the last run left something to show.
  var hasResult: Bool { card != nil || !output.isEmpty }
}

/// A small label above a block of the card.
private struct Tag: View {
  let text: String

  init(_ text: String) {
    self.text = text
  }

  var body: some View {
    Text(text)
      .font(.footnote.weight(.semibold))
      .foregroundStyle(.secondary)
  }
}
