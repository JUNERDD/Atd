import AtdAI
import SwiftUI

/// The share sheet's screens: the commands for what was shared, and a command's run pushed over
/// them. It keeps the system look (contract §2); none of the app's ink.
struct ShareRootView: View {
  @Bindable var session: ShareSession

  var body: some View {
    NavigationStack {
      CommandListView(session: session)
        .navigationDestination(item: $session.run) { run in
          RunView(run: run, finish: session.finish)
        }
    }
  }
}

/// What was shared and the commands for it: 建议 first, then 其他指令, and the one line on what
/// Atd does with the content.
struct CommandListView: View {
  let session: ShareSession

  var body: some View {
    content
      .navigationTitle(Text(verbatim: "Atd"))
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) {
          Button(role: .close, action: session.cancel)
        }
      }
  }

  @ViewBuilder private var content: some View {
    switch session.phase {
    case .reading:
      ProgressView()
    case .unreadable:
      ShareMessage(
        symbol: "questionmark.square.dashed",
        text: String(localized: "share.unreadable", bundle: .module))
    case .noModel:
      ShareMessage(symbol: "cpu", text: ModelFailure.noModel.message)
    case .ready(_, let menu) where menu.isEmpty:
      ShareMessage(
        symbol: "square.stack", text: String(localized: "share.nothingFits", bundle: .module))
    case .ready(let content, let menu):
      list(content, menu)
    }
  }

  private func list(_ content: SharedContent, _ menu: ShareMenu) -> some View {
    List {
      Section {
        PreviewRow(content: content)
      }
      if let suggested = menu.suggested {
        Section {
          CommandRow(entry: suggested, isSuggested: true) { session.open(suggested) }
        } header: {
          Text("menu.suggested", bundle: .module)
        } footer: {
          if menu.others.isEmpty { privacy(content) }
        }
      }
      if !menu.others.isEmpty {
        Section {
          ForEach(menu.others) { entry in
            CommandRow(entry: entry, isSuggested: false) { session.open(entry) }
          }
        } header: {
          Text("menu.others", bundle: .module)
        } footer: {
          privacy(content)
        }
      }
    }
  }

  /// What Atd has received and when it leaves the phone: the privacy promise for this share.
  private func privacy(_ content: SharedContent) -> Text {
    switch content {
    case .text: Text("privacy.text", bundle: .module)
    case .image: Text("privacy.image", bundle: .module)
    case .page(let page) where page.text == nil: Text("privacy.link", bundle: .module)
    case .page: Text("privacy.page", bundle: .module)
    }
  }
}

/// A command to run: its tile, name and what it will do, a taller row for the suggested one.
private struct CommandRow: View {
  let entry: ShareMenu.Entry
  let isSuggested: Bool
  let open: () -> Void

  var body: some View {
    Button(action: open) {
      HStack(spacing: 12) {
        CommandTile(command: entry.command, size: isSuggested ? 40 : 32)
        VStack(alignment: .leading, spacing: 2) {
          Text(entry.command.name)
            .font(.body.weight(.semibold))
          if !entry.subtitle.isEmpty {
            Text(entry.subtitle)
              .font(.subheadline)
              .foregroundStyle(.secondary)
              .lineLimit(1)
          }
        }
        Spacer(minLength: 8)
        Image(systemName: "chevron.forward")
          .font(.footnote.weight(.semibold))
          .foregroundStyle(.tertiary)
          .accessibilityHidden(true)
      }
      .padding(.vertical, isSuggested ? 6 : 2)
      .contentShape(.rect)
    }
    .foregroundStyle(.primary)
  }
}

/// What Atd received: the image's thumbnail or a glyph, the page's title or the text's first
/// line, and what kind of content it is.
struct PreviewRow: View {
  let content: SharedContent

  @Environment(\.dynamicTypeSize) private var typeSize

  var body: some View {
    HStack(spacing: 12) {
      thumbnail
        .frame(width: 52, height: 52)
        .clipShape(.rect(cornerRadius: 12, style: .continuous))
        .accessibilityHidden(true)
      VStack(alignment: .leading, spacing: 2) {
        Text(title)
          .font(.body.weight(.semibold))
          // Large text wraps rather than leaving a word or two.
          .lineLimit(typeSize.isAccessibilitySize ? 3 : 1)
        Text(kind)
          .font(.subheadline)
          .foregroundStyle(.secondary)
      }
    }
    .accessibilityElement(children: .combine)
  }

  @ViewBuilder private var thumbnail: some View {
    if case .image(let image) = content, let preview = image.preview {
      Image(uiImage: preview)
        .resizable()
        .scaledToFill()
    } else {
      Image(systemName: symbol)
        .font(.title2)
        .foregroundStyle(.secondary)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(.fill.tertiary)
    }
  }

  private var symbol: String {
    switch content {
    case .text: "text.quote"
    case .page: "safari"
    case .image: "photo"
    }
  }

  private var title: String {
    switch content {
    case .text(let text): text.oneLine ?? ""
    case .page(let page): page.title ?? page.host
    case .image(let image): image.name ?? String(localized: "preview.photo", bundle: .module)
    }
  }

  private var kind: String {
    switch content {
    case .text: String(localized: "preview.text", bundle: .module)
    case .page(let page) where page.text == nil: String(localized: "preview.link", bundle: .module)
    case .page: String(localized: "preview.page", bundle: .module)
    case .image: String(localized: "preview.oneImage", bundle: .module)
    }
  }
}
