import AICore
import SwiftUI

/// The text command row docked above the lightbox's bottom bar, in the lightbox's bar style
/// (Figma `App / Screenshot command slot`, Text all and Text picked): the scope chip (what a
/// command reads: the picks, with × to clear them, or all the text) | the commands placed on
/// screenshot text, each with its options menu when it has options, the selection toolbar's with
/// the screenshot-text outputs (``LongScreenshotTextMenus``) | Copy, which copies the text without
/// AI. A command running shows a bar under its button. When the commands do not fit the column,
/// they scroll sideways within the row's own height.
struct IslandLongScreenshotTextRow: View {
  let content: IslandLongScreenshotLightbox

  var body: some View {
    ViewThatFits(in: .horizontal) {
      row(scrolls: false).fixedSize()
      row(scrolls: true)
    }
    .accessibilityElement(children: .contain)
    .accessibilityLabel(Text(verbatim: content.labels.textRow))
  }

  private func row(scrolls: Bool) -> some View {
    let commands = content.textCommands
    let catalog = content.services.catalog()
    return IslandLightboxBar(leading: IslandMetrics.lightboxBarTrailing) {
      IslandLongScreenshotScopeChip(content: content)
      if !commands.isEmpty {
        IslandLightboxDivider()
        let buttons = HStack(spacing: 2) {
          ForEach(commands, id: \.id) { command in
            IslandLongScreenshotCommandButton(
              content: content, command: command, hasOptions: catalog.contains(command.id))
          }
        }
        if scrolls {
          ScrollView(.horizontal, showsIndicators: false) { buttons }
        } else {
          buttons
        }
      }
      IslandLightboxDivider()
      IslandLongScreenshotTextCopy(content: content)
    }
    .modifier(IslandLongScreenshotBarHover())
  }
}

/// What a command reads (Figma `App / Capture text scope chip`): "Selected · 3 paragraphs" with
/// × to clear the picks, or "All text · 14 paragraphs", on the scope tint.
private struct IslandLongScreenshotScopeChip: View {
  let content: IslandLongScreenshotLightbox

  var body: some View {
    let scope = content.text.scope
    let picked = scope.kind == .picked
    let text = content.results.model.labels.scope(scope)
    HStack(spacing: 4) {
      IslandGlyph(name: "square-dashed-text", side: 14)
      Text(verbatim: text).font(IslandType.label).monospacedDigit().lineLimit(1)
      if picked {
        IslandIconButton(
          glyph: AnnotationIcons.cancel,
          label: ShellStrings.shared.text(CaptureTextStringKey.scopeClear), side: 24
        ) { content.text.clear() }
      }
    }
    .padding(.leading, 10)
    .padding(.trailing, picked ? 2 : 10)
    .frame(height: IslandMetrics.controlSide)
    .background { Capsule().fill(Color.accentColor.opacity(0.3)) }
    .fixedSize()
    .accessibilityElement(children: .contain)
  }
}

/// One command: its name runs it; the chevron beside it opens its options menu (no tooltip: it
/// opens a popup). While its run reads or writes, a running bar stands under its button.
private struct IslandLongScreenshotCommandButton: View {
  let content: IslandLongScreenshotLightbox
  let command: SelectionToolbarSettings.Command
  let hasOptions: Bool
  @State private var hovered = false

  var body: some View {
    let labels = content.labels
    let running = content.results.runningCommand == command.id
    let open = content.menus.openCommand == command.id
    HStack(spacing: 0) {
      IslandTextButton(title: command.name, tooltip: labels.runTooltip(command.name)) {
        content.run(command)
      }
      .overlay(alignment: .bottom) {
        if running {
          IslandRunBar()
            .frame(height: 2)
            .padding(.horizontal, 9)
            .padding(.bottom, 3)
            .allowsHitTesting(false)
            .accessibilityHidden(true)
        }
      }
      .accessibilityValue(Text(verbatim: running ? labels.running : ""))
      if hasOptions {
        Button {
          content.menus.toggle(command)
        } label: {
          IslandGlyph(name: open ? "chevron-up" : "chevron-down", side: 14)
            .allowsHitTesting(false)
            .frame(width: 20, height: IslandMetrics.controlSide)
        }
        .buttonStyle(IslandWashStyle(shape: Capsule(), hovered: hovered || open))
        .background { LongScreenshotTextMenuAnchor(box: content.menus.anchor(for: command.id)) }
        .modifier(FloatingHover { hovered = $0 })
        .accessibilityLabel(
          Text(verbatim: ShellStrings.shared.text(.commandOptionsMenu, command.name)))
      }
    }
  }
}

/// Copy: the picked text, or all of it, without AI; then how many paragraphs went, for a moment.
private struct IslandLongScreenshotTextCopy: View {
  let content: IslandLongScreenshotLightbox

  var body: some View {
    let labels = content.labels
    let copied = content.text.copied.map(content.results.model.labels.copiedText)
    IslandTextButton(
      title: copied ?? labels.textCopy, tooltip: copied ?? labels.textCopyTooltip,
      glyph: copied == nil ? IslandIcons.copy : "check"
    ) { content.copyText() }
  }
}
