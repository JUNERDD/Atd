import AICore
import AppKit
import SwiftUI

/// The lightbox window's root: the scrim, which closes the lightbox on a click, under the
/// content (``IslandLightboxContent/view``), all in the dark scheme.
struct IslandLightboxRoot: View {
  let model: IslandLightboxModel
  let content: AnyView

  var body: some View {
    ZStack(alignment: .topLeading) {
      IslandLightboxScrim()
        .opacity(model.phase == .shown ? 1 : 0)
        .animation(
          .easeOut(
            duration: model.reduceMotion
              ? IslandChoreography.lightboxReducedFade : IslandChoreography.lightboxScrimFade),
          value: model.phase
        )
        .contentShape(Rectangle())
        .onTapGesture { model.close() }
        .accessibilityHidden(true)
      content
    }
    .frame(width: model.size.width, height: model.size.height, alignment: .topLeading)
    .environment(\.colorScheme, .dark)
    .environment(\.floatingHoverActive, model.phase == .shown)
    .ignoresSafeArea()
  }
}

/// The scrim: the desktop blurred behind the window under black at ``IslandMetrics/lightboxScrim``,
/// or near-opaque black under Reduce Transparency, which has no blur.
private struct IslandLightboxScrim: View {
  @Environment(\.accessibilityReduceTransparency) private var reduceTransparency

  var body: some View {
    ZStack {
      if !reduceTransparency { IslandLightboxBlur() }
      Color.black.opacity(
        reduceTransparency ? IslandMetrics.lightboxScrimOpaque : IslandMetrics.lightboxScrim)
    }
  }
}

/// The desktop behind the window, blurred and dark. It takes no clicks: the scrim over it does.
private struct IslandLightboxBlur: NSViewRepresentable {
  func makeNSView(context: Context) -> NSVisualEffectView {
    let effect = IslandLightboxBlurView()
    effect.material = .fullScreenUI
    effect.blendingMode = .behindWindow
    effect.state = .active
    effect.appearance = NSAppearance(named: .darkAqua)
    effect.setAccessibilityElement(false)
    return effect
  }

  func updateNSView(_ effect: NSVisualEffectView, context: Context) {}
}

private final class IslandLightboxBlurView: NSVisualEffectView {
  override func hitTest(_ point: NSPoint) -> NSView? { nil }
}

/// A lightbox bar: its content in a row on the shell's glass capsule, pinned dark, `height` tall
/// with ``IslandMetrics/lightboxBarLeading`` and ``IslandMetrics/lightboxBarTrailing`` inside its
/// ends. Bars of two rows pass a rounded rectangle as `outline`. The whole outline takes the
/// pointer, so a click between its controls never reaches the scrim, which would close.
struct IslandLightboxBar<Content: View>: View {
  var height: CGFloat? = IslandMetrics.lightboxTopBarHeight
  var outline = AnyShape(Capsule())
  var leading: CGFloat = IslandMetrics.lightboxBarLeading
  var trailing: CGFloat = IslandMetrics.lightboxBarTrailing
  @ViewBuilder let content: () -> Content

  var body: some View {
    HStack(spacing: 2) { content() }
      .padding(.leading, leading)
      .padding(.trailing, trailing)
      .frame(height: height)
      .glassSurface(in: outline, animation: nil, dark: true)
      .contentShape(outline)
  }
}

/// A thin vertical rule between a bar's groups.
struct IslandLightboxDivider: View {
  var body: some View {
    Rectangle()
      .fill(Color.primary.opacity(0.14))
      .frame(width: 1, height: 18)
      .padding(.horizontal, 6)
      .accessibilityHidden(true)
  }
}
