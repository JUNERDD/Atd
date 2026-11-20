import AtdAI
import AtdInk
import AtdModel
import Observation
import SwiftUI

/// Runs a command on sample text and streams the result, so a change to its 要求 or options can
/// be tried before the keyboard uses it. Nothing is written anywhere.
struct TrialCard: View {
  let command: Command
  @Environment(AppStore.self) private var store
  @State private var trial = TrialRun()
  @State private var input: String
  @State private var addingModel = false

  init(command: Command) {
    self.command = command
    _input = State(initialValue: TrialSample.text(for: command))
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      if command.input != .none {
        VStack(alignment: .leading, spacing: 3) {
          Tag(AppText.string("trial.input"))
          TextField(AppText.string("trial.placeholder"), text: $input, axis: .vertical)
            .lineLimit(1...8)
            .lineSpacing(3)
            .accessibilityLabel(AppText.string("trial.input"))
        }
      }
      if trial.isRunning || !trial.output.isEmpty || trial.failure != nil {
        VStack(alignment: .leading, spacing: 3) {
          Tag(AppText.string("trial.output"))
          if let failure = trial.failure {
            Text(failure.message).foregroundStyle(.secondary)
          } else if trial.output.isEmpty {
            ProgressView().frame(minHeight: 22)
          } else {
            Text(trial.output)
              .lineSpacing(3)
              .textSelection(.enabled)
          }
        }
        .padding(.top, 12)
        .overlay(alignment: .top) { Divider() }
        .accessibilityElement(children: .combine)
      }
      button
    }
    .padding(.horizontal, 16)
    .padding(.top, 14)
    .padding(.bottom, 16)
    .inkCard(seed: 4)
    .onDisappear { trial.stop() }
    .sheet(isPresented: $addingModel) {
      ConnectionEditor(connection: nil)
    }
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
        trial.start(command, input: input, runner: store.runner) { store.noteFailure($0) }
      } label: {
        Label(runTitle, systemImage: trial.hasRun ? "arrow.counterclockwise" : "play.fill")
      }
      .buttonStyle(InkButtonStyle(form: .block))
      .disabled(command.input != .none && input.trimmingCharacters(in: .whitespaces).isEmpty)
    }
  }

  /// 试运行, then 再试一次; after an option changed, the button itself says so.
  private var runTitle: String {
    guard let ranWith = trial.ranWith else { return AppText.string("trial.run") }
    return ranWith == command.values
      ? AppText.string("trial.again") : AppText.string("trial.newOptions")
  }
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

/// One trial run at a time: its streamed output, or why it stopped.
@Observable
final class TrialRun {
  private(set) var output = ""
  private(set) var isRunning = false
  private(set) var failure: ModelFailure?
  /// The option values of the last run.
  private(set) var ranWith: [String: String]?
  @ObservationIgnored private var task: Task<Void, Never>?
  /// The run whose output is on show; a stopped run's late deltas are dropped.
  @ObservationIgnored private var current: UUID?

  var hasRun: Bool { ranWith != nil }

  func start(
    _ command: Command, input: String, runner: some TextGenerating,
    onFailure: @escaping (ModelFailure) -> Void
  ) {
    task?.cancel()
    output = ""
    failure = nil
    isRunning = true
    ranWith = command.values
    let text = command.input == .none ? "" : input.trimmingCharacters(in: .whitespacesAndNewlines)
    let request = CommandPrompt.request(.command(command), input: text)
    let run = UUID()
    current = run
    task = Task {
      do {
        for try await delta in runner.stream(request, choice: command.model) {
          guard current == run else { return }
          output += delta
        }
        guard current == run else { return }
        if output.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
          failure = .unreadable(detail: nil)
        }
      } catch let error as ModelFailure {
        guard current == run else { return }
        failure = error
        onFailure(error)
      } catch {
        // Stopped.
      }
      if current == run { isRunning = false }
    }
  }

  func stop() {
    task?.cancel()
    task = nil
    current = nil
    isRunning = false
  }
}
