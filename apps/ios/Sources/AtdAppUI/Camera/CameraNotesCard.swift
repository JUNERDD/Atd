import AtdAI
import AtdInk
import AtdModel
import SwiftUI

/// 整理白板's card: the board's sections (numbered like the dashed regions on the photo) and its
/// to-dos, as 整理成 asked. 加到提醒事项 adds the to-dos to the default list and can be undone;
/// 拷贝笔记 copies everything. Without Reminders access the card offers 拷贝待办 and 去设置.
struct CameraNotesCard: View {
  let command: Command
  let notes: NotesCard
  let marks: [CameraMark]
  @Environment(AppStore.self) private var store
  @State private var outcome: CameraActionOutcome<[String]>?
  @State private var adding = false

  var body: some View {
    VStack(alignment: .leading, spacing: 16) {
      CameraCardHead(command: command, title: notes.title ?? command.name)
      ForEach(Array(notes.sections.enumerated()), id: \.offset) { index, section in
        VStack(alignment: .leading, spacing: 6) {
          HStack(alignment: .firstTextBaseline, spacing: 8) {
            if let number = CameraMarkName.number(of: .section(index + 1), in: marks) {
              CameraBadge(number: number)
            }
            Text(section.heading).font(.headline)
          }
          ForEach(Array(section.bullets.enumerated()), id: \.offset) { _, bullet in
            Label {
              Text(bullet)
            } icon: {
              Text("•").accessibilityHidden(true)
            }
            .font(.subheadline)
          }
        }
        .accessibilityElement(children: .combine)
      }
      if !notes.todos.isEmpty {
        Text(CameraCopy.string("camera.notes.todos")).font(.headline)
        InkList(inset: 34) {
          ForEach(Array(notes.todos.enumerated()), id: \.offset) { _, todo in
            HStack(alignment: .firstTextBaseline, spacing: 10) {
              InkShape(corners: .round, wobble: 0.5, seed: 17)
                .stroke(InkColor.line, lineWidth: 1.2)
                .frame(width: 18, height: 18)
                .accessibilityHidden(true)
              Text(todo.text).frame(maxWidth: .infinity, alignment: .leading)
              if let owner = todo.owner {
                Text(owner).font(.subheadline).foregroundStyle(.secondary)
              }
            }
            .padding(.vertical, 10)
            .accessibilityElement(children: .combine)
          }
        }
      }
      actions
    }
  }

  @ViewBuilder private var actions: some View {
    if notes.todos.isEmpty {
      copyNotes(kind: .filled)
    } else {
      switch outcome {
      case nil, .failed:
        if case .failed(let message) = outcome {
          Text(message).font(.footnote).foregroundStyle(InkColor.alert)
        }
        Button(CameraCopy.string("camera.notes.add"), action: add)
          .buttonStyle(InkButtonStyle(kind: .filled, form: .block))
          .inkBusy(adding)
      case .done(let ids):
        CameraDoneNote(text: CameraCopy.string("camera.notes.added \(ids.count)")) {
          remove(ids)
        }
      case .denied:
        CameraDeniedNote(
          text: CameraCopy.string("camera.notes.denied"),
          copyTitle: CameraCopy.string("camera.notes.copyTodos")
        ) {
          CameraActions.copy(todoText)
        }
      }
      copyNotes(kind: .bordered)
    }
  }

  private func copyNotes(kind: InkButtonStyle.Kind) -> some View {
    CameraCopyButton(
      title: CameraCopy.string("camera.notes.copy"),
      copiedTitle: CameraCopy.string("camera.notes.copied"), text: { notesText }, kind: kind)
  }

  /// The to-dos, one per line, with who does each.
  private var todoText: String {
    notes.todos.map { todo in
      "☐ " + todo.text + (todo.owner.map { "（\($0)）" } ?? "")
    }.joined(separator: "\n")
  }

  /// The title, the sections with their bullets, then the to-dos.
  private var notesText: String {
    var parts = [notes.title ?? command.name]
    for section in notes.sections {
      parts.append(([section.heading] + section.bullets.map { "• " + $0 }).joined(separator: "\n"))
    }
    if !notes.todos.isEmpty {
      parts.append(CameraCopy.string("camera.notes.todos") + "\n" + todoText)
    }
    return parts.joined(separator: "\n\n")
  }

  private func add() {
    adding = true
    Task {
      outcome = await CameraActions(store: store.store).addReminders(notes.todos)
      adding = false
    }
  }

  private func remove(_ ids: [String]) {
    Task {
      if await CameraActions(store: store.store).removeReminders(ids) { outcome = nil }
    }
  }
}
