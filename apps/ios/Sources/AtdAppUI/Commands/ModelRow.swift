import AtdModel
import SwiftUI

/// A command's 模型 row: 默认, which follows 我的 › 模型, or a connection and one of its models.
/// It opens the picker; the choice is saved with the command, and the trial run, the keyboard and
/// every other entry point run the command on it.
struct ModelRow: View {
  @Binding var choice: ModelChoice
  @Environment(AppStore.self) private var store
  @State private var picking = false

  var body: some View {
    Button {
      picking = true
    } label: {
      ViewThatFits(in: .horizontal) {
        HStack(spacing: 12) {
          title
          Spacer(minLength: 8)
          Text(value)
            .foregroundStyle(.secondary)
            .fixedSize()
          chevron
        }
        // At large text sizes the value moves under the title, where it can wrap.
        HStack(spacing: 12) {
          VStack(alignment: .leading, spacing: 2) {
            title
            Text(value).foregroundStyle(.secondary)
          }
          .frame(maxWidth: .infinity, alignment: .leading)
          chevron
        }
      }
      .padding(.horizontal, 20)
      .padding(.vertical, 6)
      .frame(minHeight: 44)
      .contentShape(Rectangle())
    }
    .buttonStyle(RowButtonStyle())
    .accessibilityLabel(AppText.string("command.model"))
    .accessibilityValue(value)
    .sheet(isPresented: $picking) {
      ModelPicker(choice: $choice)
    }
  }

  private var title: some View {
    Text(AppText.string("command.model")).foregroundStyle(.primary)
  }

  private var chevron: some View {
    Image(systemName: "chevron.right")
      .font(.footnote.weight(.semibold))
      .foregroundStyle(.tertiary)
      .accessibilityHidden(true)
  }

  private var value: String {
    store.settings.label(choice)
  }
}

extension AppSettings {
  /// What the 模型 row says: 默认, or the connection's name and the model.
  @MainActor func label(_ choice: ModelChoice) -> String {
    guard let pinned = pinned(choice) else { return AppText.string("model.default") }
    return AppText.string("model.connection \(pinned.connection.name) \(pinned.model)")
  }
}
