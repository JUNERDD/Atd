import AtdAutomations
import AtdInk
import AtdModel
import SwiftUI

/// 新建自动化: pick the kind of moment, then what Atd does then, in order. A trigger brings no
/// text, photo or share, so only what can run without one is offered: Atd's own steps, 今日简报,
/// commands that read nothing, and text commands, which work on an earlier step's result.
struct NewAutomationSheet: View {
  let onSaved: (Automation) -> Void
  @Environment(AppStore.self) private var store
  @Environment(\.dismiss) private var dismiss
  @State private var family: TriggerFamily?
  @State private var picked: [AutomationStep] = []

  static let maxSteps = 6

  /// - Parameter family: the kind of moment already picked, which opens on its steps.
  init(family: TriggerFamily? = nil, onSaved: @escaping (Automation) -> Void) {
    _family = State(initialValue: family)
    self.onSaved = onSaved
  }

  var body: some View {
    VStack(spacing: 0) {
      SheetHeader(
        title: AutomationText.string(family == nil ? "new.title" : "new.pick")
      ) {
        if family == nil {
          CloseButton { dismiss() }
        } else {
          Button {
            family = nil
            picked = []
          } label: {
            Image(systemName: "chevron.left").font(.system(size: 17, weight: .semibold))
          }
          .buttonStyle(InkButtonStyle(form: .round))
          .accessibilityLabel(AutomationText.string("new.back"))
        }
      } trailing: {
        Button(AutomationText.string("new.save"), action: save)
          .buttonStyle(InkButtonStyle(kind: .filled))
          .disabled(family == nil || picked.isEmpty)
      }
      ScrollView {
        if family == nil { families } else { choices }
      }
    }
    .presentationDetents([.large])
    .presentationBackground(InkColor.paper)
  }

  private var families: some View {
    InkList(inset: 68) {
      ForEach(TriggerFamily.allCases, id: \.self) { family in
        Button {
          self.family = family
        } label: {
          HStack(spacing: 14) {
            Sticker(symbol: family.symbol, tint: family.tint, seed: family.rawValue, size: 34)
            Text(family.label)
              .foregroundStyle(.primary)
              .frame(maxWidth: .infinity, alignment: .leading)
            Image(systemName: "chevron.right")
              .font(.footnote.weight(.semibold))
              .foregroundStyle(.tertiary)
              .accessibilityHidden(true)
          }
          .padding(.horizontal, 20)
          .frame(minHeight: 56)
          .contentShape(Rectangle())
        }
        .buttonStyle(RowButtonStyle())
      }
    }
  }

  private var choices: some View {
    VStack(spacing: 0) {
      SectionHeader(AutomationText.string("new.builtin"))
      InkList(inset: 68) {
        ForEach(Self.atdSteps(), id: \.self) { step in
          choice(step, symbol: step.symbol(commands: store.library), tint: .gray)
        }
      }
      SectionHeader(AutomationText.string("new.commands"))
      InkList(inset: 68) {
        ForEach(store.library.commands.filter(Self.canRun)) { command in
          let step: AutomationStep =
            command.id == BuiltinCommands.briefingID
            ? .briefing(day: .today) : .command(id: command.id)
          choice(step, symbol: command.symbol, tint: command.tint)
        }
      }
      SectionFooter(AutomationText.string("new.footer"))
    }
  }

  /// A step to pick: its sticker, its name, and its place in the order once picked.
  private func choice(_ step: AutomationStep, symbol: String, tint: CommandTint) -> some View {
    let order = picked.firstIndex(of: step)
    let needsText = Self.readsText(step, in: store.library) && !hasText(before: order)
    let full = order == nil && picked.count >= Self.maxSteps
    return Button {
      toggle(step)
    } label: {
      HStack(spacing: 14) {
        Sticker(symbol: symbol, tint: tint, seed: symbol, size: 34)
        VStack(alignment: .leading, spacing: 1) {
          Text(step.title(commands: store.library))
            .foregroundStyle(.primary)
          if needsText && order == nil {
            Text(AutomationText.string("new.needsText"))
              .font(.footnote)
              .foregroundStyle(.secondary)
          }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        if let order {
          Text(verbatim: "\(order + 1)")
            .font(.subheadline.weight(.bold))
            .foregroundStyle(InkColor.paper)
            .frame(width: 26, height: 26)
            .background(Color.primary, in: Circle())
            .accessibilityLabel(AutomationText.string("new.order \(order + 1)"))
        } else {
          Circle()
            .stroke(InkColor.line, lineWidth: 1.2)
            .frame(width: 24, height: 24)
            .accessibilityHidden(true)
        }
      }
      .padding(.horizontal, 20)
      .padding(.vertical, 8)
      .frame(minHeight: 56)
      .contentShape(Rectangle())
    }
    .buttonStyle(RowButtonStyle())
    .disabled(order == nil && (needsText || full))
    .accessibilityAddTraits(order != nil ? .isSelected : [])
  }

  private func toggle(_ step: AutomationStep) {
    if let index = picked.firstIndex(of: step) {
      picked.remove(at: index)
      // A text command left without an earlier result to work on goes too.
      var kept: [AutomationStep] = []
      for step in picked
      where !Self.readsText(step, in: store.library) || kept.contains(where: \.givesText) {
        kept.append(step)
      }
      picked = kept
    } else if picked.count < Self.maxSteps {
      picked.append(step)
    }
  }

  /// Whether a step picked before `order` (or before any new one) leaves text to work on.
  private func hasText(before order: Int?) -> Bool {
    picked.prefix(order ?? picked.count).contains(where: \.givesText)
  }

  private func save() {
    guard let family, !picked.isEmpty else { return }
    let names = picked.map { $0.title(commands: store.library) }
    onSaved(
      Automation(
        id: UUID().uuidString,
        trigger: AutomationTrigger(family: family, title: family.genericTitle),
        name: names.joined(separator: " + "), symbol: family.symbol, tint: family.tint,
        steps: picked))
  }

  /// Atd's own steps: the agenda, the ledger and a message.
  static func atdSteps() -> [AutomationStep] {
    [
      .agenda(day: .today), .agenda(day: .tomorrow), .ledgerToday,
      .message(draft: MessageDraft(body: AutomationText.string("new.messageBody"))),
    ]
  }

  /// Commands a trigger can run: 今日简报, and commands whose result is text and that read
  /// nothing or text.
  static func canRun(_ command: Command) -> Bool {
    if command.id == BuiltinCommands.briefingID { return true }
    return command.output.cardKind == .text && [.none, .text, .copied].contains(command.input)
  }

  /// Whether the step needs an earlier step's text.
  static func readsText(_ step: AutomationStep, in library: CommandLibrary) -> Bool {
    guard case .command(let id) = step, let command = library.command(id) else { return false }
    return command.input != .none
  }
}
