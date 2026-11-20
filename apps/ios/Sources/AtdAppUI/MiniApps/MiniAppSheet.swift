import AtdInk
import AtdMiniApps
import AtdModel
import SwiftUI

/// A mini app opened from its card: 改一改 and 小组件 above the app's own page. After 改一改 a
/// green line says what changed, with 撤销 until the sheet closes; a page that reports an error
/// offers 修复, which asks the model to fix it.
struct MiniAppSheet: View {
  let model: MiniAppsModel
  let appID: String
  @Environment(AppStore.self) private var store
  @Environment(\.dismiss) private var dismiss
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @State private var mode = Mode.app
  @State private var host: MiniAppPageHost?
  @State private var flash: Refined?
  /// 修复, or a request a check starts with.
  @State private var autostart: RefineView.Autostart?
  /// The 小组件 panel opens with the add guide showing.
  @State private var guiding = false

  private enum Mode {
    case app, refine, widget
  }

  private struct Refined {
    let summary: String
    let undo: MiniAppUndo
  }

  var body: some View {
    VStack(spacing: 0) {
      SheetHeader(title: title) {
        if mode == .app {
          CloseButton { dismiss() }
        } else {
          BackButton(label: MiniAppText.string("sheet.back")) {
            autostart = nil
            mode = .app
          }
        }
      } trailing: {
        EmptyView()
      }
      if let app = model.app(appID) {
        switch mode {
        case .app: page(app)
        case .refine:
          RefineView(model: model, app: app, autostart: autostart) { summary, undo in
            refined(summary, undo)
          }
        case .widget:
          WidgetPanel(app: app, glance: model.glances[appID] ?? .missing(app), guiding: guiding)
        }
      } else {
        Spacer()
      }
    }
    .presentationDetents([.large])
    .presentationBackground(InkColor.paper)
    .task {
      guard host == nil else { return }
      let store = store
      let host = MiniAppPageHost(
        source: StoredMiniAppSource(model: model, appID: appID) { store.expenseBook },
        url: MiniAppSandbox.url(app: appID))
      self.host = host
      #if DEBUG
        takeDebugAction()
      #endif
      await host.start()
    }
    .onChange(of: model.changes) { host?.refresh() }
    .onDisappear {
      host?.stop()
      model.flushWidgets()
    }
  }

  private var title: String {
    switch mode {
    case .app: model.app(appID)?.name ?? ""
    case .refine: MiniAppText.string("refine.title")
    case .widget: MiniAppText.string("widget.title")
    }
  }

  private func page(_ app: MiniApp) -> some View {
    VStack(spacing: 14) {
      HStack(spacing: 8) {
        Button {
          autostart = nil
          mode = .refine
        } label: {
          Label(MiniAppText.string("refine.title"), systemImage: "wand.and.sparkles")
            .frame(maxWidth: .infinity)
        }
        Button {
          mode = .widget
        } label: {
          Label(MiniAppText.string("widget.title"), systemImage: "square.grid.2x2")
            .frame(maxWidth: .infinity)
        }
      }
      .buttonStyle(InkButtonStyle())
      .padding(.horizontal, 16)
      if let flash {
        MiniAppFlash(
          text: flash.summary.isEmpty ? MiniAppText.string("refine.done") : flash.summary,
          action: InkAction(label: MiniAppText.string("refine.undo")) { undo(flash.undo) }
        )
        .padding(.horizontal, 16)
        .transition(.opacity)
      } else if let error = host?.error {
        MiniAppFlash(
          text: MiniAppText.string("page.error"), symbol: "exclamationmark.triangle",
          action: InkAction(label: MiniAppText.string("page.fix")) {
            autostart = .fix(error)
            mode = .refine
          }
        )
        .padding(.horizontal, 16)
        .transition(.opacity)
      }
      if let host {
        MiniAppWebView(host: host, label: MiniAppText.string("page.label \(app.name)"))
      } else {
        Spacer()
      }
    }
    .padding(.top, 8)
    .animation(reduceMotion ? nil : .snappy, value: flash?.undo)
  }

  private func refined(_ summary: String, _ undo: MiniAppUndo) {
    autostart = nil
    flash = Refined(summary: summary, undo: undo)
    mode = .app
    host?.load()
  }

  #if DEBUG
    /// `-AtdDebug miniapp refine` and `widget` for this app.
    private func takeDebugAction() {
      let action = MiniAppDebug.take { action -> MiniAppDebug.Action? in
        switch action {
        case .refine(let id, _), .widget(let id): id == appID ? action : nil
        case .build: nil
        }
      }
      switch action {
      case .refine(_, let request)?:
        autostart = .request(request)
        mode = .refine
      case .widget?:
        guiding = true
        mode = .widget
      case .build?, nil:
        break
      }
    }
  #endif

  private func undo(_ undo: MiniAppUndo) {
    do {
      try model.undo(undo)
      flash = nil
      host?.load()
    } catch {
      store.failure = MiniAppText.string("failure.save")
    }
  }
}

extension AppStore {
  /// The book 记一笔 logs into (its 记到), which 记账本's own 记一笔 follows.
  var expenseBook: String {
    let key = BuiltinCommands.OptionKey.book
    return library.command(BuiltinCommands.expenseID)?.option(key)?.value
      ?? CommandLibrary.initial().command(BuiltinCommands.expenseID)?.option(key)?.value ?? ""
  }
}
