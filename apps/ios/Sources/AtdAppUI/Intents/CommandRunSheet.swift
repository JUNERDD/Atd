import AtdAI
import AtdInk
import AtdIntents
import AtdModel
import SwiftUI
import UIKit

/// A command a control ran in Atd: the 运行指令 control's command that reads text,
/// run on the clipboard, or one that reads nothing while Live Activities are off. It shows the
/// command, then its result with the one action the result is for: 拷贝, 添加到日历 or 记入.
struct CommandRunSheet: View {
  let request: CommandRunRequest
  @Environment(AppStore.self) private var store
  @Environment(\.dismiss) private var dismiss
  @Environment(\.openURL) private var openURL
  @State private var run = CommandSheetRun()
  /// Bumped by 重试, which restarts the run.
  @State private var attempt = 0

  var body: some View {
    VStack(spacing: 0) {
      SheetHeader(title: command?.displayName ?? "", showsTitle: false) {
        CloseButton { dismiss() }
      } trailing: {
        EmptyView()
      }
      if let command {
        ScrollView {
          VStack(alignment: .leading, spacing: 20) {
            HStack(spacing: 12) {
              Sticker(symbol: command.symbol, tint: command.tint, seed: command.id, size: 40)
              Text(command.displayName)
                .font(.title2.bold())
                .accessibilityAddTraits(.isHeader)
            }
            result(of: command)
          }
          .frame(maxWidth: .infinity, alignment: .leading)
          .padding(.horizontal, 20)
          .padding(.vertical, 16)
        }
        action(for: command)
          .padding(.horizontal, 20)
          .padding(.bottom, 16)
      } else {
        Text(String(localized: IntentFailure.commandMissing.localizedStringResource))
          .foregroundStyle(.secondary)
          .frame(maxWidth: .infinity, maxHeight: .infinity)
      }
    }
    .presentationDetents([.medium, .large])
    .presentationBackground(InkColor.paper)
    .task(id: attempt) {
      guard let command else { return }
      let context = EntryContext(store: store.store, generator: store.runner)
      await run.start(command, context: context) { store.noteFailure($0) }
    }
  }

  private var command: Command? {
    store.library.command(request.commandID)
  }

  @ViewBuilder private func result(of command: Command) -> some View {
    switch run.phase {
    case .working:
      HStack(spacing: 8) {
        ProgressView()
        Text(EntryText.string("run.working"))
          .foregroundStyle(.secondary)
      }
    case .done(let card):
      VStack(alignment: .leading, spacing: 6) {
        ForEach(Array(CardText.lines(card).enumerated()), id: \.offset) { _, line in
          Text(line)
            .fixedSize(horizontal: false, vertical: true)
            .textSelection(.enabled)
        }
      }
      .frame(maxWidth: .infinity, alignment: .leading)
      .padding(16)
      .inkCard(seed: inkSeed(command.id))
      if let problem = run.actionProblem {
        Text(problem.message)
          .font(.footnote)
          .foregroundStyle(.secondary)
      }
    case .failed(let problem):
      Text(problem.message)
        .foregroundStyle(.secondary)
    }
  }

  /// The one button under the result: what the card is for, or what helps a failure.
  @ViewBuilder private func action(for command: Command) -> some View {
    switch run.phase {
    case .working:
      EmptyView()
    case .done(let card):
      if let problem = run.actionProblem, let remedy = problem.remedy {
        remedyButton(remedy)
      } else {
        cardButton(card)
      }
    case .failed(let problem):
      if let remedy = problem.remedy {
        remedyButton(remedy)
      }
    }
  }

  @ViewBuilder private func cardButton(_ card: CardResult) -> some View {
    switch card {
    case .event(let draft):
      Button {
        Task { await run.add(draft) }
      } label: {
        Label(
          EntryText.string(run.outcome == .added ? "run.added" : "run.addEvent"),
          systemImage: run.outcome == .added ? "checkmark" : "calendar.badge.plus")
      }
      .buttonStyle(InkButtonStyle(kind: .filled, form: .block))
      .disabled(run.outcome == .added)
    case .expense(let draft):
      Button {
        run.log(draft, store: store.store)
      } label: {
        Label(
          run.outcome == .logged(draft.book)
            ? EntryText.string("run.logged \(draft.book)")
            : EntryText.string("run.log \(draft.book)"),
          systemImage: run.outcome == .logged(draft.book) ? "checkmark" : "tray.and.arrow.down")
      }
      .buttonStyle(InkButtonStyle(kind: .filled, form: .block))
      .disabled(run.outcome == .logged(draft.book))
    case .text, .briefing, .notes:
      Button {
        run.copy(card)
      } label: {
        Label(
          EntryText.string(run.outcome == .copied ? "run.copied" : "run.copy"),
          systemImage: run.outcome == .copied ? "checkmark" : "doc.on.doc")
      }
      .buttonStyle(InkButtonStyle(kind: .filled, form: .block))
    }
  }

  private func remedyButton(_ remedy: CommandSheetRun.Problem.Remedy) -> some View {
    Button {
      switch remedy {
      case .retry:
        attempt += 1
      case .addModel:
        // The root closes this sheet and shows 我的 › 模型.
        RouteCenter.shared.open(.models)
      case .settings:
        if let url = URL(string: UIApplication.openSettingsURLString) { openURL(url) }
      }
    } label: {
      switch remedy {
      case .retry: Label(EntryText.string("run.retry"), systemImage: "arrow.clockwise")
      case .addModel: Label(AppText.string("models.add"), systemImage: "plus")
      case .settings: Label(EntryText.string("run.settings"), systemImage: "gear")
      }
    }
    .buttonStyle(InkButtonStyle(kind: .filled, form: .block))
  }
}
