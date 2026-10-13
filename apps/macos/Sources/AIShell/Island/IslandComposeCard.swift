import AICore
import AppKit
import SwiftUI

/// The compose card the island grows into where a command was launched with nothing selected:
/// the options and answer cards' corner, padding, title row and footer around a text field for
/// the text that stands in for the selection. The title is the command's name with a close
/// button that cancels; under it the note says nothing is selected (or, after an attachment that
/// did not go as asked, why); the field grows a line at a time up to
/// ``IslandMetrics/composeMaxLines`` and scrolls inside past them; attached files show as chips
/// on one row under it that scrolls sideways (``IslandComposeChips``), each with a way to
/// remove it. The footer has the attach control when the command takes files, and Open in Atd
/// beside Run, which runs once there is text or a file. Nothing in the card is cut mid-glyph:
/// the title and file names end in an ellipsis, the note wraps (then ends in one), chips past
/// the row's edge go under its fade, and the card is never narrower than its footer.
///
/// The draft is the model's (``IslandModel/compose``); every change goes to the controller as an
/// ``IslandComposeEvent``, which re-measures the card (``measureCompose(command:attach:)``). Keys
/// reach the card through its window first (``CommandProgressController/composeKey(_:)``). The
/// command's name and file names are user data, shown untranslated and cut with an ellipsis.
struct IslandComposeCard: View {
  let model: IslandModel
  let command: String
  let attach: Bool
  /// The card that has the pointer and the keyboard; a leaving one is inert.
  let active: Bool
  var width: Double?
  var height: Double?
  @FocusState private var fieldFocused: Bool
  /// The attach control's frame in the window, where its menu opens.
  @State private var attachFrame = CGRect.zero

  var body: some View {
    let draft = model.compose
    VStack(alignment: .leading, spacing: 0) {
      header
      IslandComposeNote(model: model, note: draft.note, attach: attach)
        .padding(.bottom, IslandMetrics.noteGap + IslandMetrics.sectionGap)
      field(draft.text)
      if !draft.files.isEmpty {
        IslandComposeChips(model: model, files: draft.files, active: active)
          .padding(.top, IslandMetrics.sectionGap)
      }
      Spacer(minLength: 0)
      footer(canRun: draft.canRun).padding(.top, IslandMetrics.sectionGap)
    }
    .padding(IslandMetrics.cardPadding)
    .frame(
      width: width.map { CGFloat($0) }, height: height.map { CGFloat($0) }, alignment: .topLeading
    )
    .accessibilityElement(children: .contain)
    .accessibilityLabel(Text(verbatim: model.labels.compose(command)))
  }

  /// The title row and the footer alone, at their ideal width: what the card's width follows,
  /// so typing and attaching never change it.
  var widthProbe: some View {
    VStack(alignment: .leading, spacing: 0) {
      header
      footer(canRun: true)
    }
    .padding(IslandMetrics.cardPadding)
  }

  /// The command's name, as the other cards' title, and the close button, which cancels.
  private var header: some View {
    HStack(spacing: 8) {
      Text(verbatim: command)
        .font(.system(size: 12, weight: .semibold))
        .foregroundStyle(.secondary)
        .lineLimit(1)
        .truncationMode(.tail)
        .padding(.leading, IslandMetrics.rowPadding)
        .help(command)
        .accessibilityAddTraits(.isHeader)
      Spacer(minLength: 0)
      IslandIconButton(glyph: AnnotationIcons.cancel, label: model.labels.close) {
        model.act(.cancel)
      }
    }
    .frame(height: IslandMetrics.headerHeight)
  }

  /// The text field on the options card's filter wash, as tall as the measured card makes room
  /// for; past ``IslandMetrics/composeMaxLines`` its text scrolls inside it.
  private func field(_ text: String) -> some View {
    let binding = Binding(get: { model.compose.text }, set: { model.composeEvent(.text($0)) })
    let placeholder = model.labels.composePlaceholder
    return TextField(text: binding, prompt: Text(verbatim: placeholder), axis: .vertical) {
      Text(verbatim: placeholder)
    }
    .textFieldStyle(.plain)
    .font(IslandType.answer)
    .lineLimit(1...IslandMetrics.composeMaxLines)
    .focused($fieldFocused)
    .disabled(!active)
    .padding(.horizontal, IslandMetrics.rowPadding)
    .padding(.vertical, IslandMetrics.composeFieldInset)
    .frame(maxWidth: .infinity, alignment: .topLeading)
    .background {
      IslandWash(
        level: 0.06,
        shape: RoundedRectangle(cornerRadius: IslandMetrics.composeRadius, style: .continuous))
    }
    // As the options card's filter: the field takes focus once the card is active and its
    // window has the keyboard, and again when the window takes it back after an attachment.
    .onChange(of: active && model.cardIsKey, initial: true) { _, focus in fieldFocused = focus }
  }

  private func footer(canRun: Bool) -> some View {
    let labels = model.labels
    return HStack(spacing: 10) {
      if attach {
        // The panel composer's attach control: a plus, its menu opening against it.
        IslandIconButton(glyph: IslandIcons.attach, label: labels.composeAttach) {
          model.composeEvent(.attach(attachFrame))
        }
        .onGeometryChange(for: CGRect.self) {
          $0.frame(in: .global)
        } action: {
          attachFrame = $0
        }
      }
      Spacer(minLength: 8)
      HStack(spacing: IslandMetrics.gap) {
        IslandTextButton(title: labels.openInAtd, tooltip: labels.openInAtdTooltip) {
          model.composeEvent(.open)
        }
        .disabled(!canRun)
        IslandTextButton(title: labels.run, rest: 0.08, action: { model.composeEvent(.run) }) {
          IslandKeycap(symbol: "↩")
        }
        .disabled(!canRun)
      }
      // Without text or a file there is nothing to run or open with.
      .opacity(canRun ? 1 : 0.5)
    }
    .padding(.leading, attach ? 0 : 4)
    .frame(height: IslandMetrics.footerHeight)
  }
}

/// The note under the compose card's title: that nothing is selected, in the hint type and the
/// secondary colour; or a problem with the last attachment, in the label colour after a warning
/// glyph, with Open System Settings beside a refused screenshot's. It wraps to
/// ``IslandMetrics/maxNoteLines`` lines and ends in an ellipsis past them, its whole text the
/// tooltip.
struct IslandComposeNote: View {
  let model: IslandModel
  let note: ComposeDraft.Note?
  let attach: Bool

  /// The note's words for `note` in a card that offers attachments (`attach`) or not.
  static func text(_ note: ComposeDraft.Note?, attach: Bool, labels: IslandLabels) -> String {
    switch note {
    case .limit: labels.composeLimit
    case .screenRecording: labels.composeScreenRecording
    case .failed(let message): message
    case nil: attach ? labels.composeNoteAttach : labels.composeNote
    }
  }

  var body: some View {
    let text = Self.text(note, attach: attach, labels: model.labels)
    HStack(spacing: 8) {
      HStack(alignment: .firstTextBaseline, spacing: 4) {
        if note != nil {
          IslandGlyph(name: IslandIcons.warning, side: 12)
            .alignmentGuide(.firstTextBaseline) { $0[.bottom] - 2 }
        }
        Text(verbatim: text)
          .font(IslandType.hint)
          .lineLimit(IslandMetrics.maxNoteLines)
          .truncationMode(.tail)
          .fixedSize(horizontal: false, vertical: true)
      }
      .foregroundStyle(note == nil ? AnyShapeStyle(.secondary) : AnyShapeStyle(.primary))
      .frame(maxWidth: .infinity, alignment: .leading)
      .help(text)
      if note == .screenRecording {
        IslandTextButton(title: model.labels.composeOpenSystemSettings) {
          model.composeEvent(.openScreenRecordingSettings)
        }
      }
    }
    .padding(.horizontal, IslandMetrics.rowPadding)
  }
}
