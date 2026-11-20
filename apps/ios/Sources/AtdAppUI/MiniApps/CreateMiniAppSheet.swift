import AtdAI
import AtdInk
import AtdMiniApps
import AtdModel
import SwiftUI

/// 新建小应用: one sentence, then the default model builds the app in four steps the person
/// watches (理解需求, 设计数据, 生成界面, 生成小组件), then a preview with its widget and its page
/// running on a copy of its data. 添加到主屏幕 saves it and shows how to add the widget; 先存在小应用里
/// only saves it.
struct CreateMiniAppSheet: View {
  let model: MiniAppsModel
  #if DEBUG
    /// `-AtdDebug miniapp build`: the sentence to generate from at once, and whether to keep
    /// the app a few seconds after its preview shows.
    var debugStart: (sentence: String, save: Bool)?
  #endif
  let onSaved: (MiniApp) -> Void
  @Environment(AppStore.self) private var store
  @Environment(\.dismiss) private var dismiss
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @State private var phase = Phase.describe
  @State private var text = ""
  @State private var progress = 0
  @State private var details: [String: String] = [:]
  @State private var preview: Preview?
  @State private var failure: ModelFailure?
  @State private var running: Task<Void, Never>?
  @State private var addingModel = false
  @State private var saved: MiniApp?
  @FocusState private var describing: Bool

  private enum Phase {
    case describe, build, preview, guide
  }

  /// A built app before it is saved, and its page running on the draft's data.
  struct Preview {
    let draft: MiniAppDraft
    let source: DraftMiniAppSource
    let host: MiniAppPageHost
  }

  var body: some View {
    VStack(spacing: 0) {
      SheetHeader(title: title) {
        switch phase {
        case .describe: CloseButton { dismiss() }
        case .build: EmptyView()
        case .preview:
          BackButton(label: AppText.string("new.back")) {
            close(preview)
            phase = .describe
          }
        case .guide: EmptyView()
        }
      } trailing: {
        EmptyView()
      }
      switch phase {
      case .describe: ScrollView { describe }.scrollDismissesKeyboard(.interactively)
      case .build:
        ScrollView {
          BuildSteps(
            task: MiniAppText.string("new.building"), steps: steps, current: progress, stop: stop)
        }
      case .preview:
        if let preview {
          CreatePreview(preview: preview, addToHome: { save(guide: true) }, keep: { save() })
        }
      case .guide:
        ScrollView {
          AddWidgetGuide(name: saved?.name ?? "") { finish() }
            .padding(.horizontal, 16)
            .padding(.top, 8)
        }
      }
    }
    .presentationDetents([.large])
    .presentationBackground(InkColor.paper)
    // A built app is lost on dismissal, so only the buttons close the sheet then.
    .interactiveDismissDisabled(phase == .build || phase == .preview)
    .onAppear {
      describing = true
      #if DEBUG
        if let debugStart {
          text = debugStart.sentence
          generate()
        }
      #endif
    }
    .onDisappear {
      running?.cancel()
      close(preview)
    }
    .sheet(isPresented: $addingModel) {
      ConnectionEditor(connection: nil)
    }
  }

  private var title: String {
    switch phase {
    case .describe: MiniAppText.string("apps.new")
    case .build: MiniAppText.string("new.building")
    case .preview: preview?.draft.app.name ?? ""
    case .guide: MiniAppText.string("guide.title")
    }
  }

  private var steps: [BuildSteps.Step] {
    [
      .init(MiniAppText.string("build.step.understand"), details["understand"]),
      .init(MiniAppText.string("build.step.data"), details["data"]),
      .init(MiniAppText.string("build.step.page"), details["page"]),
      .init(MiniAppText.string("build.step.widget"), details["widget"]),
    ]
  }

  private var describe: some View {
    VStack(alignment: .leading, spacing: 14) {
      TextField(MiniAppText.string("new.field"), text: $text, axis: .vertical)
        .lineLimit(3...8)
        .lineSpacing(3)
        .focused($describing)
        .inkField(focused: describing)
        .accessibilityLabel(MiniAppText.string("new.field"))
      MiniAppChips(label: MiniAppText.string("new.examples"), items: Self.examples) { text = $0 }
      if let failure {
        Text(failure.message)
          .font(.footnote)
          .foregroundStyle(.secondary)
      }
      if store.hasModel {
        Button(action: generate) {
          Label(
            MiniAppText.string(failure?.canRetry == true ? "new.retry" : "new.generate"),
            systemImage: "sparkles")
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

  /// The examples fill the field with a whole sentence; the field starts empty so the person's
  /// own words come first.
  private static var examples: [(label: String, text: String)] {
    [
      (MiniAppText.string("new.example.reading"), MiniAppText.string("new.example.reading.text")),
      (MiniAppText.string("new.example.guitar"), MiniAppText.string("new.example.guitar.text")),
      (MiniAppText.string("new.example.steps"), MiniAppText.string("new.example.steps.text")),
    ]
  }

  private func generate() {
    let description = text.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !description.isEmpty, store.hasModel else { return }
    describing = false
    failure = nil
    progress = 0
    details = [:]
    phase = .build
    let request = MiniAppPrompt.build(description, language: MiniAppText.language)
    let runner = store.runner
    running = Task {
      do {
        let draft = try await MiniAppRun.draft(request, runner: runner) { answer in
          let about = answer.about
          withAnimation(reduceMotion ? nil : .easeOut(duration: 0.3)) {
            progress = answer.buildProgress
            details = about
          }
        }
        let source = DraftMiniAppSource(draft)
        let host = MiniAppPageHost(source: source, url: MiniAppSandbox.url(draft: UUID()))
        preview = Preview(draft: draft, source: source, host: host)
        running = nil
        phase = .preview
        await host.start()
        #if DEBUG
          if debugStart?.save == true {
            try? await Task.sleep(for: .seconds(8))
            if phase == .preview { save() }
          }
        #endif
      } catch is CancellationError {
        running = nil
      } catch {
        guard !Task.isCancelled else { return }
        let failure = (error as? ModelFailure) ?? .unreadable(detail: nil)
        store.noteFailure(failure)
        self.failure = failure
        running = nil
        phase = .describe
      }
    }
  }

  private func stop() {
    running?.cancel()
    running = nil
    phase = .describe
  }

  /// Saves the app with what the person did on its preview page.
  private func save(guide: Bool = false) {
    guard let preview else { return }
    var draft = preview.draft
    draft.data = preview.source.draft.data
    do {
      try withAnimation(reduceMotion ? nil : .snappy(duration: 0.5)) {
        try model.create(draft, data: draft.data)
      }
    } catch {
      store.failure = MiniAppText.string("failure.save")
      return
    }
    close(preview)
    self.preview = nil
    saved = draft.app
    if guide { phase = .guide } else { finish() }
  }

  private func finish() {
    if let saved { onSaved(saved) } else { dismiss() }
  }

  private func close(_ preview: Preview?) {
    preview?.host.stop()
    if phase == .preview { self.preview = nil }
  }
}

/// The preview of a new app: its small widget on a wallpaper, the two ways to keep it, then the
/// page as it will open, running on the draft's data.
struct CreatePreview: View {
  let preview: CreateMiniAppSheet.Preview
  let addToHome: () -> Void
  let keep: () -> Void

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      WidgetWall(height: 176) {
        WidgetPreviewFrame(glance: preview.source.draft.glance, family: .small)
      }
      .padding(.horizontal, 16)
      .padding(.top, 8)
      VStack(spacing: 4) {
        Button(action: addToHome) {
          Label(MiniAppText.string("preview.addToHome"), systemImage: "plus.square")
        }
        .buttonStyle(InkButtonStyle(kind: .filled, form: .block))
        Button(MiniAppText.string("preview.keep"), action: keep)
          .font(.body.weight(.medium))
          .foregroundStyle(.primary)
          .frame(maxWidth: .infinity, minHeight: 44)
      }
      .padding(.horizontal, 16)
      .padding(.top, 16)
      SectionHeader(MiniAppText.string("preview.page"))
        .padding(.top, -12)
      MiniAppWebView(
        host: preview.host,
        label: MiniAppText.string("preview.label \(preview.draft.app.name)"))
    }
  }
}

extension MiniAppDraft {
  /// What its widget shows now, from the draft's data.
  var glance: MiniAppGlance {
    MiniAppGlance.make(app: app, manifest: package.manifest, data: data, ledger: nil)
  }
}
