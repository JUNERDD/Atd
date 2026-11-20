import AtdInk
import AtdModel
import SwiftUI

/// The 指令 tab: every command in the library, each row saying where it shows up. A row opens the
/// command's editor; 新建指令 drafts one from a sentence or starts from a blank form.
struct CommandsPage: View {
  @Environment(AppStore.self) private var store
  @State private var opened: OpenedCommand?
  @State private var creating = false
  /// A command just added, marked for a moment so the eye finds it.
  @State private var fresh: String?

  var body: some View {
    ScrollViewReader { scroller in
      InkPage(
        title: AppText.string("commands.title"), art: .commands,
        add: InkAction(label: AppText.string("commands.new")) { creating = true }
      ) {
        InkList(inset: 74) {
          ForEach(store.library.commands) { command in
            Button {
              opened = OpenedCommand(id: command.id)
            } label: {
              CommandRow(command: command, fresh: fresh == command.id)
            }
            .buttonStyle(RowButtonStyle())
            .id(command.id)
          }
        }
      }
      .onChange(of: fresh) { _, id in
        guard let id else { return }
        withAnimation { scroller.scrollTo(id, anchor: .center) }
      }
    }
    .sheet(item: $opened) { opened in
      CommandDetailSheet(id: opened.id)
    }
    .sheet(isPresented: $creating) {
      NewCommandSheet { command in
        creating = false
        highlight(command)
      }
    }
  }

  private func highlight(_ command: Command) {
    fresh = command.id
    AccessibilityNotification.Announcement(
      AppText.string("commands.added \(command.displayName)")
    ).post()
    Task {
      try? await Task.sleep(for: .seconds(3))
      if fresh == command.id { fresh = nil }
    }
  }
}

private struct OpenedCommand: Identifiable {
  let id: String
}

/// A command's row: its sticker, its name and where it shows up.
private struct CommandRow: View {
  let command: Command
  let fresh: Bool
  @Environment(\.accessibilityReduceMotion) private var reduceMotion

  var body: some View {
    HStack(spacing: 14) {
      Sticker(symbol: command.symbol, tint: command.tint, seed: command.id)
      VStack(alignment: .leading, spacing: 1) {
        Text(command.displayName)
          .font(.body.weight(.medium))
          .foregroundStyle(.primary)
        Text(command.whereLabel)
          .font(.subheadline)
          .foregroundStyle(.secondary)
      }
      .lineLimit(1)
      .frame(maxWidth: .infinity, alignment: .leading)
    }
    .padding(.horizontal, 20)
    .padding(.vertical, 10)
    .frame(minHeight: 64)
    .background(InkColor.sticker(command.tint).opacity(fresh ? 1 : 0))
    .animation(reduceMotion ? nil : .easeOut(duration: fresh ? 0.2 : 1.4), value: fresh)
    .contentShape(Rectangle())
    .accessibilityElement(children: .combine)
  }
}

/// A row that darkens a little while pressed, like ink pressed into the paper.
struct RowButtonStyle: ButtonStyle {
  func makeBody(configuration: Configuration) -> some View {
    configuration.label
      .background(configuration.isPressed ? InkColor.press : Color.clear)
  }
}

/// A command's editor in a sheet. Changes are saved as they are made, and the keyboard uses
/// them the next time it appears.
struct CommandDetailSheet: View {
  let id: String
  @Environment(AppStore.self) private var store
  @Environment(\.dismiss) private var dismiss
  @State private var confirmingDelete = false

  var body: some View {
    VStack(spacing: 0) {
      if let command = store.library.command(id) {
        SheetHeader(title: command.displayName, showsTitle: false) {
          CloseButton { dismiss() }
        } trailing: {
          EmptyView()
        }
        ScrollView {
          CommandForm(command: binding(command))
          if !command.isBuiltin {
            Button(AppText.string("commands.delete"), role: .destructive) {
              confirmingDelete = true
            }
            .frame(minHeight: 44)
            .padding(.top, 28)
            .confirmationDialog(
              AppText.string("commands.delete.confirm \(command.displayName)"),
              isPresented: $confirmingDelete, titleVisibility: .visible
            ) {
              Button(AppText.string("commands.delete"), role: .destructive) {
                dismiss()
                store.removeCommand(command.id)
              }
            }
          }
        }
        .scrollDismissesKeyboard(.interactively)
      }
    }
    .presentationDetents([.large])
    .presentationBackground(InkColor.paper)
  }

  /// Reads the stored command and saves every change to it.
  private func binding(_ fallback: Command) -> Binding<Command> {
    Binding(
      get: { store.library.command(id) ?? fallback },
      set: { store.save($0) })
  }
}
