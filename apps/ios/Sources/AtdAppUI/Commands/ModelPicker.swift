import AtdModel
import SwiftUI

/// Picks the model a command runs on: 默认, or a connection, whose page lists the models its
/// provider offers. Picking one closes the sheet.
struct ModelPicker: View {
  @Binding var choice: ModelChoice
  @Environment(AppStore.self) private var store
  @Environment(\.dismiss) private var dismiss
  /// The connection whose models are on show; nil on the first page.
  @State private var opened: ProviderConnection?

  var body: some View {
    VStack(spacing: 0) {
      SheetHeader(title: opened?.name ?? AppText.string("command.model")) {
        if opened == nil {
          CloseButton { dismiss() }
        } else {
          BackButton(label: AppText.string("action.back")) { opened = nil }
        }
      } trailing: {
        EmptyView()
      }
      ScrollView {
        if let opened {
          ConnectionModels(connection: opened, chosen: chosenModel(in: opened)) { model in
            choice = .connection(id: opened.id, model: model)
            dismiss()
          }
        } else {
          choices
        }
      }
    }
    .presentationDetents([.large])
    .presentationBackground(InkColor.paper)
  }

  /// 默认 first, then every connection with the model it would run.
  private var choices: some View {
    let pinned = store.settings.pinned(choice)
    return InkList(inset: 62) {
      PickerRow(
        title: AppText.string("model.default"), subtitle: defaultSubtitle, selected: pinned == nil
      ) {
        choice = .appDefault
        dismiss()
      }
      ForEach(store.settings.connections) { connection in
        let chosen = pinned?.connection.id == connection.id
        PickerRow(
          title: connection.name, subtitle: chosen ? pinned?.model : connection.model,
          selected: chosen, opens: true
        ) {
          opened = connection
        }
      }
    }
    .padding(.top, 8)
  }

  /// What 默认 runs on now.
  private var defaultSubtitle: String {
    guard let connection = store.settings.defaultConnection else {
      return AppText.string("models.none")
    }
    return AppText.string("model.connection \(connection.name) \(connection.model)")
  }

  private func chosenModel(in connection: ProviderConnection) -> String? {
    guard let pinned = store.settings.pinned(choice), pinned.connection.id == connection.id
    else { return nil }
    return pinned.model
  }
}

/// A row of the picker: a mark that is filled for the one in use, the title with one line under
/// it, and a chevron when the row opens a page instead of picking.
struct PickerRow: View {
  let title: String
  var subtitle: String?
  let selected: Bool
  var opens = false
  let action: () -> Void
  @Environment(\.dynamicTypeSize) private var typeSize

  var body: some View {
    Button(action: action) {
      HStack(spacing: 0) {
        Image(systemName: selected ? "checkmark.circle.fill" : "circle")
          .font(.title3)
          .foregroundStyle(selected ? Color.primary : Color.secondary)
          .frame(width: 62)
          .accessibilityHidden(true)
        VStack(alignment: .leading, spacing: 1) {
          Text(title)
            .font(.body.weight(.medium))
            .foregroundStyle(.primary)
          if let subtitle {
            Text(subtitle)
              .font(.subheadline)
              .foregroundStyle(.secondary)
          }
        }
        // Model ids differ in their last words, so they are cut in the middle; at the largest
        // text sizes they wrap instead.
        .lineLimit(typeSize.isAccessibilitySize ? 3 : 1)
        .truncationMode(.middle)
        .frame(maxWidth: .infinity, alignment: .leading)
        if opens {
          Image(systemName: "chevron.right")
            .font(.footnote.weight(.semibold))
            .foregroundStyle(.tertiary)
            .accessibilityHidden(true)
        }
      }
      .padding(.trailing, 20)
      .padding(.vertical, 6)
      .frame(minHeight: 53)
      .contentShape(Rectangle())
      .accessibilityElement(children: .combine)
    }
    .buttonStyle(RowButtonStyle())
    .accessibilityAddTraits(selected ? .isSelected : [])
  }
}
