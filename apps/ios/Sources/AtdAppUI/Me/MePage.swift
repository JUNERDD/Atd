import AtdModel
import SwiftUI

/// The 我的 tab: the models, the keyboard and its phrases, and what Atd sends.
struct MePage: View {
  @Environment(AppStore.self) private var store

  var body: some View {
    NavigationStack {
      InkPage(title: AppText.string("me.title"), art: .me) {
        AboutCard()

        SectionHeader(AppText.string("me.models"))
        InkList(inset: 62) {
          NavigationLink {
            ModelsPage()
          } label: {
            SettingsRow(
              symbol: "key", title: AppText.string("me.defaultModel"), value: modelValue,
              valueColor: modelRefused ? InkColor.alert : .secondary)
          }
          .buttonStyle(RowButtonStyle())
        }

        SectionHeader(AppText.string("me.keyboard"))
        InkList(inset: 62) {
          NavigationLink {
            KeyboardSetupPage()
          } label: {
            SettingsRow(
              symbol: "keyboard", title: AppText.string("me.keyboardStatus"),
              value: store.keyboard.hasReported
                ? AppText.string("keyboard.ready.short") : AppText.string("keyboard.notFound"))
          }
          .buttonStyle(RowButtonStyle())
          NavigationLink {
            PhrasesPage()
          } label: {
            SettingsRow(
              symbol: "quote.opening", title: AppText.string("me.phrases"),
              value: AppText.string("me.phrases.count \(store.phrases.phrases.count)"))
          }
          .buttonStyle(RowButtonStyle())
        }
        SectionFooter(AppText.string("me.privacy"), leading: 62)

        InkList(inset: 62) {
          NavigationLink {
            LicensesPage()
          } label: {
            SettingsRow(symbol: "doc.text", title: AppText.string("me.licenses"))
          }
          .buttonStyle(RowButtonStyle())
        }
        .padding(.top, 26)
      }
      .toolbar(.hidden, for: .navigationBar)
    }
  }

  private var modelRefused: Bool {
    store.settings.defaultConnection.map { store.refusedKeys.contains($0.id) } ?? false
  }

  private var modelValue: String {
    guard let connection = store.settings.defaultConnection else {
      return AppText.string("models.none")
    }
    return modelRefused ? AppText.string("models.refused") : connection.name
  }
}

/// Atd and its promise, in an inked card at the top of 我的.
private struct AboutCard: View {
  var body: some View {
    HStack(spacing: 14) {
      Image(uiImage: InkArt.markImage(side: 34))
        .renderingMode(.template)
        .foregroundStyle(.primary)
        .frame(width: 48, height: 48)
        .accessibilityHidden(true)
      VStack(alignment: .leading, spacing: 1) {
        Text(verbatim: "Atd").font(.headline)
        Text(AppText.string("me.card"))
          .font(.subheadline)
          .foregroundStyle(.secondary)
      }
    }
    .padding(.horizontal, 16)
    .padding(.vertical, 14)
    .frame(maxWidth: .infinity, alignment: .leading)
    .inkCard(seed: 2)
    .padding(.horizontal, 16)
    .padding(.top, 10)
    .padding(.bottom, 4)
    .accessibilityElement(children: .combine)
  }
}

/// A page pushed from 我的: the paper, a plain title and the page's content.
struct SubPage<Content: View>: View {
  let title: String
  @ViewBuilder let content: Content

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 0) {
        content
      }
      .padding(.bottom, 24)
    }
    .background(InkColor.paper)
    .navigationTitle(title)
    .navigationBarTitleDisplayMode(.inline)
  }
}

/// 开源许可: the licenses of what ships inside Atd.
struct LicensesPage: View {
  var body: some View {
    SubPage(title: AppText.string("me.licenses")) {
      VStack(alignment: .leading, spacing: 2) {
        Text(verbatim: "rime-pinyin-simp").font(.headline)
        Text(AppText.string("licenses.lexicon"))
          .font(.subheadline)
          .foregroundStyle(.secondary)
      }
      .padding(.horizontal, 20)
      .padding(.top, 16)
      Text(Self.lexiconLicense)
        .font(.footnote.monospaced())
        .textSelection(.enabled)
        .padding(.horizontal, 20)
        .padding(.top, 16)
    }
  }

  /// The lexicon's license, copied into the app bundle by project.yml.
  private static let lexiconLicense: String =
    Bundle.main.url(forResource: "LICENSE", withExtension: nil)
    .flatMap { try? String(contentsOf: $0, encoding: .utf8) } ?? ""
}
