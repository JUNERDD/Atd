import AICore
import AppKit
import SwiftUI

/// A single activity glyph; counts belong to the opened card, not this compact control.
struct TaskActivityEntry: View {
  let model: TaskActivityModel

  var body: some View {
    Button(action: model.toggle) {
      TaskActivityGlyphSwap(
        identity: glyph, callout: model.needsAttention ? glyph : nil,
        side: MiniPanelMetrics.glyphSide, reducedMotion: model.reducedMotion
      ) {
        IslandGlyph(name: glyph, side: MiniPanelMetrics.glyphSide)
      }
      .frame(width: TaskActivityMetrics.entrySide, height: TaskActivityMetrics.entrySide)
    }
    .buttonStyle(
      TaskActivityEntryStyle(model: model)
    )
    .background {
      IslandPaletteGlow(palette: model.glow)
        .opacity(model.glow == nil ? 0 : 1)
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
    .foregroundStyle(.primary)
    .disabled(!model.entryInteractive)
    .onChange(of: model.entryInteractive) { _, allowed in
      if !allowed { model.entryPressed = false }
    }
    .pointerStyle(.link)
    .accessibilityLabel(model.labels.text(.activityTitle))
    .accessibilityValue(
      model.labels.format(
        .activityEntryAccessibility, model.countSummary,
        model.needsAttention ? model.labels.text(.activityAttentionSuffix) : "",
        model.labels.text(model.isOpen ? .activityExpanded : .activityCollapsed))
    )
    .accessibilityIdentifier("activity.entry")
  }

  private var glyph: String {
    model.hasWarning ? "triangle-alert" : model.needsAttention ? "message-circle" : "layers"
  }
}

/// The native window tracks the press while inactive, as it does for the original controls.
private struct TaskActivityEntryStyle: ButtonStyle {
  let model: TaskActivityModel

  func makeBody(configuration: Configuration) -> some View {
    let pressed = model.entryPressed
    let level =
      pressed
      ? (model.reducedMotion ? 0.24 : 0.16) : model.entryHovered ? 0.1 : model.isOpen ? 0.08 : 0
    configuration.label
      .background { IslandWash(level: level, shape: Circle()) }
      .contentShape(Circle())
  }
}
