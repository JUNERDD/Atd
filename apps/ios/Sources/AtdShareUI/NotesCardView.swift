import AtdActions
import AtdModel
import SwiftUI

/// 整理白板's card: 整理成 on top (another choice asks again), the sections and their points, the
/// to-dos with whom they are for, then 加到提醒事项 (with 撤销 once added) and 拷贝笔记.
struct NotesCardView: View {
  let run: ShareRun

  var body: some View {
    if let notes = run.notes {
      List {
        if let axis = run.axis {
          Section {
            OptionPicker(option: axis, selection: run.choice, select: { run.select($0) })
              // Reminders already added stay with the notes they came from.
              .disabled(run.reminderIDs != nil || run.isBusy)
          }
          .listRowBackground(Color.clear)
          .listRowInsets(EdgeInsets())
        }
        if let title = notes.title {
          Section {
            Text(title).font(.title3.weight(.bold))
          }
        }
        ForEach(Array(notes.sections.enumerated()), id: \.offset) { _, section in
          Section(section.heading) {
            ForEach(Array(section.bullets.enumerated()), id: \.offset) { _, bullet in
              Text(bullet)
            }
          }
        }
        if !notes.todos.isEmpty {
          Section {
            ForEach(Array(notes.todos.enumerated()), id: \.offset) { _, todo in
              TodoRow(todo: todo)
            }
          } header: {
            Text("notes.todos", bundle: .module)
          } footer: {
            if let note = footnote { Text(note) }
          }
        }
      }
      .safeAreaBar(edge: .bottom) { actions(notes) }
    }
  }

  private var footnote: String? {
    run.denied ? CardIssue.denied(.reminders).message : run.issue?.message
  }

  @ViewBuilder private func actions(_ notes: NotesCard) -> some View {
    let copyKind: CopyButton.Kind = notes.sections.isEmpty ? .todos : .notes
    ActionBar {
      if let added = run.reminderIDs {
        HStack {
          Label {
            Text("notes.added \(added.count)", bundle: .module)
          } icon: {
            Image(systemName: "checkmark.circle.fill").foregroundStyle(.green)
          }
          Spacer()
          Button {
            Task { await run.undoReminders() }
          } label: {
            Text("done.undo", bundle: .module)
          }
          .buttonStyle(.bordered)
          .disabled(run.isBusy)
        }
        .padding(.vertical, 4)
      } else if !notes.todos.isEmpty, !run.denied {
        PrimaryButton(
          title: String(localized: "notes.addReminders", bundle: .module), symbol: "checklist",
          isBusy: run.isBusy
        ) {
          Task { await run.addReminders() }
        }
      }
      CopyButton(
        copied: run.copied, kind: copyKind,
        isProminent: notes.todos.isEmpty || run.denied, action: run.copyNotes)
    }
  }
}

/// A to-do: an empty circle, what to do, and whom it is for.
private struct TodoRow: View {
  let todo: NotesCard.Todo

  var body: some View {
    HStack(alignment: .firstTextBaseline, spacing: 10) {
      Image(systemName: "circle")
        .foregroundStyle(.secondary)
        .accessibilityHidden(true)
      Text(todo.text)
      Spacer(minLength: 8)
      if let owner = todo.owner {
        Text(owner).foregroundStyle(.secondary)
      }
    }
    .accessibilityElement(children: .combine)
  }
}
