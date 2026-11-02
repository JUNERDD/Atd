import AICore
import SwiftUI

/// One row for the answer and review cards. The island first grows to fit the complete row;
/// only a constrained display compacts secondary actions and then hint labels. Primary write
/// labels stay visible, and every compact control keeps its tooltip and accessible name.
struct IslandResultFooter: View {
  let model: IslandModel
  let offer: AnswerWriteOffer?
  var pending = false
  var showsOptionHint = false

  var body: some View {
    ViewThatFits(in: .horizontal) {
      row(compactActions: false, compactHints: false)
      row(compactActions: true, compactHints: false)
      row(compactActions: true, compactHints: true)
    }
    .padding(.leading, 4)
    .frame(height: IslandMetrics.footerHeight, alignment: .bottom)
    .fixedSize(horizontal: false, vertical: true)
  }

  /// Measure the complete row's intrinsic width, not the adaptive layout's smallest fallback.
  var widthProbe: some View {
    row(compactActions: false, compactHints: false).fixedSize().padding(.leading, 4)
  }

  private func row(compactActions: Bool, compactHints: Bool) -> some View {
    HStack(spacing: 10) {
      hints(compact: compactHints).fixedSize()
      Spacer(minLength: 8)
      actions(compact: compactActions)
    }
  }

  @ViewBuilder private func hints(compact: Bool) -> some View {
    if showsOptionHint {
      // Reserve both states so moving between the field and chips never resizes the card.
      ZStack(alignment: .leading) {
        resultHints(compact: compact).hidden().accessibilityHidden(true)
        optionHints(compact: compact).hidden().accessibilityHidden(true)
        if model.reviewChip != nil {
          optionHints(compact: compact)
        } else {
          resultHints(compact: compact)
        }
      }
    } else {
      resultHints(compact: compact)
    }
  }

  private func optionHints(compact: Bool) -> some View {
    HStack(spacing: 10) {
      hint("←→", model.labels.keyMove, compact: compact)
      hint("↑", model.labels.review.keyInput, compact: compact)
      hint("␣", model.labels.review.keySelect, compact: compact)
    }
  }

  private func resultHints(compact: Bool) -> some View {
    HStack(spacing: 10) {
      if pending {
        hint("esc", model.labels.review.stop, compact: compact)
      } else {
        hint("esc", model.labels.close, compact: compact)
      }
    }
  }

  @ViewBuilder private func hint(_ keys: String, _ label: String, compact: Bool) -> some View {
    if compact {
      IslandKeycap(symbol: keys)
        .help(label)
        .accessibilityLabel(Text(verbatim: keys + " " + label))
    } else {
      IslandKeyHint(keys: keys, label: label)
    }
  }

  private func actions(compact: Bool) -> some View {
    HStack(spacing: IslandMetrics.gap) {
      if compact {
        IslandIconButton(
          glyph: "arrow-up-right", label: model.labels.openInAtd,
          tooltip: model.labels.openInAtdTooltip
        ) { model.act(.open) }
      } else {
        IslandTextButton(title: model.labels.openInAtd, tooltip: model.labels.openInAtdTooltip) {
          model.act(.open)
        }
      }
      HStack(spacing: IslandMetrics.gap) {
        if compact {
          IslandIconButton(
            glyph: "copy", label: model.labels.copy, tooltip: model.labels.copy + " ⌘C"
          ) { model.act(.copy) }
        } else {
          IslandTextButton(
            title: model.labels.copy, tooltip: model.labels.copy + " ⌘C",
            rest: offer == nil ? 0.08 : 0, keys: "⌘C", action: { model.act(.copy) })
        }
        if let offer {
          IslandWriteButtons(model: model, offer: offer, showsKeys: !compact)
        }
      }
      .disabled(pending)
      .opacity(pending ? 0.38 : 1)
    }
    .fixedSize()
    .animation(.easeOut(duration: 0.2), value: offer)
  }
}
