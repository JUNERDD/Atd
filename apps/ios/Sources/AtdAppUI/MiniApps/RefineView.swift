import AtdAI
import AtdInk
import AtdMiniApps
import AtdModel
import SwiftUI
import UIKit

/// 改一改: the person says what to change, the default model rewrites the app and the sheet goes
/// back to it with 撤销. The data the person logged stays as it is; the widget keeps working
/// without being added again.
struct RefineView: View {
  /// A run that starts as soon as the view appears.
  enum Autostart: Equatable {
    /// 修复: the error the page reported, for the model to fix.
    case fix(String)
    case request(String)
  }

  let model: MiniAppsModel
  let app: MiniApp
  var autostart: Autostart?
  let onDone: (String, MiniAppUndo) -> Void
  @Environment(AppStore.self) private var store
  @State private var text = ""
  @State private var running: Task<Void, Never>?
  @State private var progress = 0
  @State private var summary = ""
  @State private var failure: ModelFailure?
  @State private var addingModel = false
  @FocusState private var focused: Bool

  var body: some View {
    ScrollView {
      if running != nil {
        BuildSteps(
          task: MiniAppText.string("refine.running \(app.name)"),
          steps: [
            .init(MiniAppText.string("refine.step.understand"), summary),
            .init(MiniAppText.string("refine.step.page"), MiniAppText.string("refine.keepsData")),
            .init(
              MiniAppText.string("refine.step.widget"), MiniAppText.string("refine.keepsWidget")),
          ],
          current: progress, stop: stop)
      } else {
        edit
      }
    }
    .scrollDismissesKeyboard(.interactively)
    .onAppear {
      switch autostart {
      case .fix(let error): start(MiniAppPrompt.fixRequest(error))
      case .request(let request):
        text = request
        start(request)
      case nil: focused = true
      }
    }
    .onDisappear { running?.cancel() }
    .sheet(isPresented: $addingModel) {
      ConnectionEditor(connection: nil)
    }
  }

  private var edit: some View {
    VStack(alignment: .leading, spacing: 14) {
      TextField(MiniAppText.string("refine.field"), text: $text, axis: .vertical)
        .lineLimit(3...8)
        .lineSpacing(3)
        .focused($focused)
        .inkField(focused: focused)
        .accessibilityLabel(MiniAppText.string("refine.field"))
      if !app.ideas.isEmpty {
        MiniAppChips(
          label: MiniAppText.string("refine.ideas"), items: app.ideas.map { ($0, $0) }
        ) { text = $0 }
      }
      if let failure {
        Text(failure.message)
          .font(.footnote)
          .foregroundStyle(.secondary)
      }
      if store.hasModel {
        Button {
          start(text)
        } label: {
          Label(MiniAppText.string("refine.start"), systemImage: "wand.and.sparkles")
        }
        .buttonStyle(InkButtonStyle(kind: .filled, form: .block))
        .disabled(text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
        .padding(.top, 4)
      } else {
        Button {
          addingModel = true
        } label: {
          Label(AppText.string("models.add"), systemImage: "plus")
        }
        .buttonStyle(InkButtonStyle(kind: .filled, form: .block))
      }
    }
    .padding(.horizontal, 16)
    .padding(.top, 8)
  }

  private func start(_ request: String) {
    let request = request.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !request.isEmpty, store.hasModel, let package = model.store.package(app) else { return }
    focused = false
    failure = nil
    progress = 0
    summary = ""
    let data = model.store.data(app.id, schema: package.manifest.schema)
    let prompt = MiniAppPrompt.refine(
      request, app: app, package: package, data: data, language: MiniAppText.language)
    let runner = store.runner
    running = Task {
      do {
        let refinement = try await MiniAppRun.refinement(prompt, current: package, runner: runner) {
          answer in
          progress = answer.refineProgress
          summary = answer.about["summary"] ?? ""
        }
        let undo = try model.refine(app, with: refinement)
        running = nil
        onDone(refinement.summary, undo)
      } catch is CancellationError {
        running = nil
      } catch {
        guard !Task.isCancelled else { return }
        let failure = (error as? ModelFailure) ?? .unreadable(detail: nil)
        store.noteFailure(failure)
        self.failure = failure
        running = nil
      }
    }
  }

  private func stop() {
    running?.cancel()
    running = nil
  }
}

/// The build steps, which are the progress: a done step gets a tick and its one-line detail, the
/// current one a spinner, the rest their number. 停止 goes back.
struct BuildSteps: View {
  struct Step {
    let title: String
    let detail: String?

    init(_ title: String, _ detail: String?) {
      self.title = title
      self.detail = detail
    }
  }

  let task: String
  let steps: [Step]
  let current: Int
  let stop: () -> Void

  var body: some View {
    VStack(alignment: .leading, spacing: 18) {
      VStack(alignment: .leading, spacing: 0) {
        ForEach(steps.indices, id: \.self) { index in
          row(index)
        }
      }
      .accessibilityElement(children: .contain)
      .accessibilityLabel(task)
      Button(MiniAppText.string("build.stop"), action: stop)
        .buttonStyle(InkButtonStyle(form: .block))
    }
    .padding(.horizontal, 16)
    .padding(.top, 12)
  }

  private func row(_ index: Int) -> some View {
    let step = steps[index]
    let done = index < current
    return HStack(alignment: .top, spacing: 12) {
      ZStack {
        if done {
          InkShape(corners: .round, seed: index).fill(InkColor.on)
          Image(systemName: "checkmark").font(.system(size: 13, weight: .heavy))
        } else if index == current {
          ProgressView()
        } else {
          InkShape(corners: .round, seed: index).stroke(InkColor.line, lineWidth: 1.2)
          Text(verbatim: "\(index + 1)")
            .font(.footnote.weight(.semibold))
            .foregroundStyle(.secondary)
        }
      }
      .frame(width: 28, height: 28)
      .accessibilityHidden(true)
      VStack(alignment: .leading, spacing: 2) {
        Text(step.title)
          .font(.body.weight(index > current ? .medium : .semibold))
          .foregroundStyle(index > current ? .secondary : .primary)
        if done, let detail = step.detail, !detail.isEmpty {
          Text(detail)
            .font(.footnote)
            .foregroundStyle(.secondary)
            .lineLimit(1)
            .transition(.opacity)
        }
      }
      .padding(.top, 3)
      .frame(maxWidth: .infinity, alignment: .leading)
    }
    .padding(.vertical, 10)
    .accessibilityElement(children: .combine)
    .accessibilityValue(
      done
        ? MiniAppText.string("build.done") : index == current ? MiniAppText.string("build.now") : ""
    )
  }
}

/// Streams a build or refine answer, reporting it as its sections arrive, and asks once more
/// for a data or widget section that could not be used.
enum MiniAppRun {
  static func draft(
    _ request: ModelRequest, runner: any TextGenerating, update: (MiniAppAnswer) -> Void
  ) async throws -> MiniAppDraft {
    let (answer, text) = try await stream(request, runner: runner, update: update)
    do {
      return try MiniAppDraft(answer: answer, symbolExists: symbolExists)
    } catch .section(let section, let reason) {
      let repair = try await stream(
        MiniAppPrompt.repair(request, answer: text, section: section, reason: reason),
        runner: runner
      ) { _ in }
      return try MiniAppDraft(
        answer: answer.replacing(section, from: repair.answer), symbolExists: symbolExists)
    }
  }

  static func refinement(
    _ request: ModelRequest, current: MiniAppPackage, runner: any TextGenerating,
    update: (MiniAppAnswer) -> Void
  ) async throws -> MiniAppRefinement {
    let (answer, text) = try await stream(request, runner: runner, update: update)
    do {
      return try MiniAppRefinement(answer: answer, current: current)
    } catch .section(let section, let reason) {
      let repair = try await stream(
        MiniAppPrompt.repair(request, answer: text, section: section, reason: reason),
        runner: runner
      ) { _ in }
      return try MiniAppRefinement(
        answer: answer.replacing(section, from: repair.answer), current: current)
    }
  }

  private static func stream(
    _ request: ModelRequest, runner: any TextGenerating, update: (MiniAppAnswer) -> Void
  ) async throws -> (answer: MiniAppAnswer, text: String) {
    var answer = MiniAppAnswer()
    var text = ""
    for try await delta in runner.stream(request, choice: .appDefault) {
      text += delta
      let markers = answer.markers.count
      answer.append(delta)
      if answer.markers.count != markers { update(answer) }
    }
    try Task.checkCancellation()
    answer.finish()
    update(answer)
    return (answer, text)
  }

  private static func symbolExists(_ name: String) -> Bool {
    UIImage(systemName: name) != nil
  }
}
