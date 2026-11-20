import AtdModel
import SwiftUI

/// A command's run, pushed over the list: working, its result or card, done, or why it failed.
/// Going back stops the run; 完成 ends the share.
struct RunView: View {
  let run: ShareRun
  let finish: () -> Void

  var body: some View {
    content
      .navigationTitle(run.command.name)
      .navigationBarTitleDisplayMode(.inline)
      // Done is the end: 完成 leaves, and going back to undo is 撤销's job.
      .navigationBarBackButtonHidden(run.phase == .done)
      .toolbar {
        if hasResult {
          ToolbarItem(placement: .confirmationAction) {
            Button(role: .confirm, action: finish)
          }
        }
      }
  }

  @ViewBuilder private var content: some View {
    switch run.phase {
    case .working(let step):
      WorkingView(command: run.command, step: step)
    case .text:
      TextResultView(run: run)
    case .card:
      switch run.card {
      case .event: EventCardView(run: run)
      case .expense: ExpenseCardView(run: run)
      case .notes: NotesCardView(run: run)
      case .briefing(let card): ReadCardView(run: run, lines: card.sentences)
      case .text(let card): ReadCardView(run: run, lines: [card.text])
      case nil: EmptyView()
      }
    case .done:
      DoneView(run: run)
    case .failed(let failure):
      FailureView(failure: failure, retry: run.retry)
    }
  }

  /// Whether there is something to leave with: a result, a card or its outcome.
  private var hasResult: Bool {
    switch run.phase {
    case .text, .card, .done: true
    case .working, .failed: false
    }
  }
}

/// Waiting for a page or an answer: the command's tile and what is happening.
struct WorkingView: View {
  let command: Command
  let step: ShareRun.Step

  var body: some View {
    VStack(spacing: 18) {
      CommandTile(command: command, size: 56)
      HStack(spacing: 10) {
        ProgressView()
        Text(label)
          .foregroundStyle(.secondary)
      }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .accessibilityElement(children: .combine)
  }

  private var label: String {
    switch step {
    case .readingPage: String(localized: "step.readingPage", bundle: .module)
    case .finding(.event): String(localized: "step.event", bundle: .module)
    case .finding(.expense): String(localized: "step.expense", bundle: .module)
    case .finding(.notes): String(localized: "step.notes", bundle: .module)
    case .finding: String(localized: "step.other", bundle: .module)
    }
  }
}

/// Why the run gave nothing, and 重试 when running again can help.
struct FailureView: View {
  let failure: ShareFailure
  let retry: () -> Void

  var body: some View {
    ContentUnavailableView {
      Label {
        Text(failure.message)
      } icon: {
        Image(systemName: "exclamationmark.circle")
      }
    } actions: {
      if failure.canRetry {
        Button(action: retry) {
          Text("result.retry", bundle: .module)
        }
        .buttonStyle(.bordered)
      }
    }
  }
}

/// A card that only reads: a briefing's sentences or a text, to copy.
struct ReadCardView: View {
  let run: ShareRun
  let lines: [String]

  var body: some View {
    List {
      Section {
        ForEach(Array(lines.enumerated()), id: \.offset) { _, line in
          Text(line).textSelection(.enabled)
        }
      }
    }
    .safeAreaBar(edge: .bottom) {
      ActionBar {
        CopyButton(copied: run.copied, kind: .result) {
          run.services.copy(lines.joined(separator: "\n"))
          run.copied = true
        }
      }
    }
  }
}
