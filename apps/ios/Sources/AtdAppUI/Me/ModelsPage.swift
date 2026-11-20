import AtdModel
import SwiftUI
import UIKit

/// 我的 › 模型: the connections, the default among them, and 添加模型 — the page's one primary
/// action until a model is added.
struct ModelsPage: View {
  @Environment(AppStore.self) private var store
  @State private var adding = false
  @State private var editing: ProviderConnection?

  var body: some View {
    SubPage(title: AppText.string("me.models")) {
      Button {
        adding = true
      } label: {
        Label(AppText.string("models.add"), systemImage: "plus")
      }
      .buttonStyle(InkButtonStyle(kind: store.hasModel ? .bordered : .filled))
      .padding(.horizontal, 20)
      .padding(.top, 12)
      .padding(.bottom, 8)
      InkList(inset: 62) {
        ForEach(store.settings.connections) { connection in
          ConnectionRow(
            connection: connection,
            isDefault: connection.id == store.settings.defaultConnection?.id,
            isRefused: store.refusedKeys.contains(connection.id),
            makeDefault: { store.makeDefault(connection.id) },
            open: { editing = connection })
        }
      }
    }
    .sheet(isPresented: $adding) {
      ConnectionEditor(connection: nil)
    }
    .sheet(item: $editing) { connection in
      ConnectionEditor(connection: connection)
    }
  }
}

/// A connection: a radio mark that makes it the default, then its name and model. A key the
/// provider refused shows in red until it is replaced.
private struct ConnectionRow: View {
  let connection: ProviderConnection
  let isDefault: Bool
  let isRefused: Bool
  let makeDefault: () -> Void
  let open: () -> Void

  var body: some View {
    HStack(spacing: 0) {
      Button(action: makeDefault) {
        Image(systemName: isDefault ? "checkmark.circle.fill" : "circle")
          .font(.title3)
          .foregroundStyle(isDefault ? Color.primary : Color.secondary)
          .frame(width: 62, height: 53)
          .contentShape(Rectangle())
      }
      .buttonStyle(.plain)
      .accessibilityLabel(
        isDefault ? AppText.string("models.isDefault") : AppText.string("models.makeDefault")
      )
      .accessibilityValue(connection.name)
      .accessibilityAddTraits(isDefault ? .isSelected : [])
      Button(action: open) {
        HStack(spacing: 12) {
          VStack(alignment: .leading, spacing: 1) {
            Text(connection.name)
              .font(.body.weight(.medium))
              .foregroundStyle(.primary)
            Text(isRefused ? AppText.string("models.refused") : connection.model)
              .font(.subheadline)
              .foregroundStyle(isRefused ? InkColor.alert : Color.secondary)
          }
          .lineLimit(1)
          .frame(maxWidth: .infinity, alignment: .leading)
          Image(systemName: "chevron.right")
            .font(.footnote.weight(.semibold))
            .foregroundStyle(.tertiary)
            .accessibilityHidden(true)
        }
        .padding(.trailing, 20)
        .padding(.vertical, 6)
        .frame(minHeight: 53)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
      }
      .buttonStyle(RowButtonStyle())
    }
  }
}

/// 我的 › Atd 键盘: whether the keyboard has shown up with Full Access, and until it has, the
/// steps in Settings with a button that opens Atd's page there.
struct KeyboardSetupPage: View {
  @Environment(AppStore.self) private var store
  @Environment(\.openURL) private var openURL

  var body: some View {
    SubPage(title: AppText.string("me.keyboard")) {
      let ready = store.keyboard.hasReported
      HStack(spacing: 14) {
        Glyph(symbol: ready ? "checkmark.circle" : "keyboard")
        Text(ready ? AppText.string("keyboard.ready") : AppText.string("keyboard.notFound"))
          .frame(maxWidth: .infinity, alignment: .leading)
      }
      .padding(.horizontal, 20)
      .frame(minHeight: 53)
      .accessibilityElement(children: .combine)
      if ready {
        SectionFooter(AppText.string("keyboard.switch"), leading: 62)
      } else {
        SectionHeader(AppText.string("keyboard.steps"))
        InkList(inset: 62) {
          StepRow(number: 1, text: AppText.string("keyboard.step.open"))
          StepRow(number: 2, text: AppText.string("keyboard.step.add"))
          StepRow(number: 3, text: AppText.string("keyboard.step.fullAccess"))
          StepRow(number: 4, text: AppText.string("keyboard.switch"))
        }
        Button {
          if let url = URL(string: UIApplication.openSettingsURLString) { openURL(url) }
        } label: {
          Label(AppText.string("keyboard.openSettings"), systemImage: "gear")
        }
        .buttonStyle(InkButtonStyle(kind: .filled, form: .block))
        .padding(.horizontal, 16)
        .padding(.top, 24)
        SectionFooter(AppText.string("keyboard.footer"))
      }
    }
    .onAppear { store.reload() }
  }
}

/// One step of the keyboard's setup, numbered.
private struct StepRow: View {
  let number: Int
  let text: String

  var body: some View {
    HStack(spacing: 14) {
      Text(number, format: .number)
        .font(.subheadline.weight(.semibold))
        .frame(width: 28, height: 28)
        .background(Circle().stroke(InkColor.line, lineWidth: 1.1))
        .accessibilityHidden(true)
      Text(text)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
    .padding(.horizontal, 20)
    .padding(.vertical, 8)
    .frame(minHeight: 53)
  }
}
