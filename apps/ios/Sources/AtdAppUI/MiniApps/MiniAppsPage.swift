import AtdInk
import AtdMiniApps
import AtdModel
import SwiftUI

/// The 小应用 tab: a card for each mini app, with the same live line its widget shows, and
/// 新建小应用. A card opens the app in a sheet; a `.miniApp(id:)` route (a widget, a link) opens
/// it too.
struct MiniAppsPage: View {
  private let model = MiniAppsModel.shared
  @Environment(AppStore.self) private var store
  @State private var opened: OpenedMiniApp?
  @State private var creating = false
  @State private var saved: MiniApp?
  @State private var savedNote: Task<Void, Never>?
  @State private var deleting: MiniApp?
  #if DEBUG
    @State private var debugBuild: (sentence: String, save: Bool)?
  #endif
  @Environment(\.scenePhase) private var scenePhase
  @Environment(\.dynamicTypeSize) private var typeSize
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  private let routes = RouteCenter.shared

  var body: some View {
    InkPage(
      title: AppText.string("tab.miniApps"), art: .apps,
      add: InkAction(label: MiniAppText.string("apps.new")) { creating = true }
    ) {
      VStack(alignment: .leading, spacing: 10) {
        if let saved {
          MiniAppFlash(text: MiniAppText.string("apps.saved \(saved.name)"))
            .padding(.horizontal, 16)
            .transition(.opacity.combined(with: .offset(y: reduceMotion ? 0 : 8)))
        }
        LazyVGrid(columns: columns, spacing: 12) {
          ForEach(model.library.apps) { app in
            Button {
              open(app.id)
            } label: {
              MiniAppCard(app: app, glance: model.glances[app.id])
            }
            .buttonStyle(MiniAppCardStyle())
            .contextMenu {
              if !app.builtin {
                Button(role: .destructive) {
                  deleting = app
                } label: {
                  Label(MiniAppText.string("apps.delete"), systemImage: "trash")
                }
              }
            }
            .transition(.opacity.combined(with: .scale(scale: reduceMotion ? 1 : 0.96)))
          }
        }
        .padding(.horizontal, 16)
      }
      .padding(.top, 6)
    }
    .confirmationDialog(
      MiniAppText.string("apps.delete.confirm \(deleting?.name ?? "")"),
      isPresented: deletingShown, titleVisibility: .visible, presenting: deleting
    ) { app in
      Button(MiniAppText.string("apps.delete.withData"), role: .destructive) {
        delete(app)
      }
    }
    .sheet(item: $opened, onDismiss: model.flushWidgets) { opened in
      MiniAppSheet(model: model, appID: opened.id).environment(store)
    }
    .sheet(isPresented: $creating, onDismiss: endDebugStart) {
      createSheet.environment(store)
    }
    .onChange(of: routes.pending, initial: true) {
      if let id = routes.take({ if case .miniApp(let id) = $0 { id } else { nil } }) {
        open(id)
      }
    }
    .onChange(of: scenePhase) { _, phase in
      // A widget button or an expense logged elsewhere changed data while Atd was away.
      if phase == .active { model.reload() }
    }
    #if DEBUG
      // The page can appear more than once while the launch selects its tab: only the first
      // appearance finds the action.
      .task {
        let build = MiniAppDebug.take {
          if case .build(let sentence, let save) = $0 { (sentence, save) } else { nil }
        }
        if let build {
          debugBuild = build
          creating = true
        }
      }
    #endif
  }

  /// A launch's debug build runs once; 新建小应用 opened later starts empty.
  private func endDebugStart() {
    #if DEBUG
      debugBuild = nil
    #endif
  }

  private var createSheet: CreateMiniAppSheet {
    #if DEBUG
      CreateMiniAppSheet(model: model, debugStart: debugBuild) { app in
        creating = false
        noteSaved(app)
      }
    #else
      CreateMiniAppSheet(model: model) { app in
        creating = false
        noteSaved(app)
      }
    #endif
  }

  /// Two cards a row; one at the largest text sizes, where the names need the width.
  private var columns: [GridItem] {
    let count = typeSize.isAccessibilitySize ? 1 : 2
    return Array(repeating: GridItem(.flexible(), spacing: 12, alignment: .top), count: count)
  }

  private var deletingShown: Binding<Bool> {
    Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } })
  }

  private func open(_ id: String) {
    guard let app = model.app(id) else { return }
    model.opened(app)
    opened = OpenedMiniApp(id: id)
  }

  private func delete(_ app: MiniApp) {
    withAnimation(reduceMotion ? nil : .snappy) {
      do {
        try model.delete(app)
      } catch {
        store.failure = MiniAppText.string("failure.save")
      }
    }
  }

  /// 「X」存好了 for six seconds, while the new card comes in.
  private func noteSaved(_ app: MiniApp) {
    savedNote?.cancel()
    withAnimation(reduceMotion ? nil : .snappy(duration: 0.38)) { saved = app }
    savedNote = Task {
      try? await Task.sleep(for: .seconds(6))
      guard !Task.isCancelled else { return }
      withAnimation(reduceMotion ? nil : .easeOut(duration: 0.3)) { saved = nil }
    }
  }
}

private struct OpenedMiniApp: Identifiable {
  let id: String
}

/// A mini app on the tab: its sticker, its name and one live line (本月 ¥2,384, 今天 5/8 杯,
/// 已打包 7/12), from the same glance its widget draws.
struct MiniAppCard: View {
  let app: MiniApp
  let glance: MiniAppGlance?

  var body: some View {
    VStack(alignment: .leading, spacing: 2) {
      Sticker(symbol: app.symbol, tint: app.tint, seed: app.id, size: 44)
        .padding(.bottom, 16)
        .frame(maxHeight: .infinity, alignment: .top)
      Text(app.name)
        .font(.headline)
        .foregroundStyle(.primary)
        .lineLimit(2)
      Text(glance?.meta ?? " ")
        .font(.subheadline)
        .foregroundStyle(.secondary)
        .monospacedDigit()
        .lineLimit(1)
    }
    .padding(16)
    .frame(maxWidth: .infinity, minHeight: 142, alignment: .leading)
    .contentShape(Rectangle())
    .inkCard(seed: inkSeed(app.id))
    .accessibilityElement(children: .combine)
    .accessibilityHint(glance?.label ?? "")
  }
}

/// Presses a card in, like the kit's pressable cards.
private struct MiniAppCardStyle: ButtonStyle {
  @Environment(\.accessibilityReduceMotion) private var reduceMotion

  func makeBody(configuration: Configuration) -> some View {
    configuration.label
      .background {
        if configuration.isPressed {
          InkShape(corners: .card, seed: 2).fill(InkColor.press)
        }
      }
      .scaleEffect(configuration.isPressed && !reduceMotion ? 0.98 : 1)
      .animation(.snappy(duration: 0.18), value: configuration.isPressed)
  }
}
