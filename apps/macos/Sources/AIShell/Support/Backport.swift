import SwiftUI

/// SwiftUI APIs newer than the deployment target that need no design decision on older systems,
/// called through the `backport` namespace (`.backport.scrollEdgeEffectHidden()`). Where the
/// native API exists the member calls it; elsewhere it does nothing or returns the content as is.
/// A capability whose older look is a design choice (the materials, the screenshot) stays in the
/// type that owns it instead (``NativeMaterialView``, ``GlassSurface``, ``DisplayFreezer``).
///
/// Every member is deprecated from the version that has the native API, so raising the minimum
/// system to it turns each call site into a warning naming the API to call directly; that change
/// removes the member. Until the deployment target drops below it, those warnings are expected.
struct Backport<Content> {
  let content: Content
}

extension View {
  /// This view's ``Backport`` members.
  var backport: Backport<Self> { Backport(content: self) }
}

extension Backport where Content: View {
  /// How a glass shape enters and leaves its container (`GlassEffectTransition`); the shell uses
  /// only these two.
  enum GlassTransition {
    /// No transition of the glass's own.
    case identity
    /// The system's default: the glass materializes in place.
    case materialize
  }

  /// `scrollEdgeEffectHidden(_:for:)`. macOS 15 has no scroll edge effect, so there is nothing
  /// to hide.
  @available(macOS, deprecated: 26, message: "use scrollEdgeEffectHidden(_:for:)")
  @ViewBuilder func scrollEdgeEffectHidden(_ hidden: Bool = true, for edges: Edge.Set = .all)
    -> some View
  {
    if #available(macOS 26, *) {
      content.scrollEdgeEffectHidden(hidden, for: edges)
    } else {
      content
    }
  }

  /// `glassEffectTransition(_:)`. macOS 15 draws no Liquid Glass, so no glass transitions.
  @available(macOS, deprecated: 26, message: "use glassEffectTransition(_:)")
  @ViewBuilder func glassEffectTransition(_ transition: GlassTransition) -> some View {
    if #available(macOS 26, *) {
      switch transition {
      case .identity: content.glassEffectTransition(.identity)
      case .materialize: content.glassEffectTransition(.materialize)
      }
    } else {
      content
    }
  }

  /// This content in a `GlassEffectContainer(spacing:)`, which draws the glass shapes inside it
  /// together and blends those within `spacing` of one another. macOS 15 has neither the
  /// container nor the blending, so the content stands on its own.
  @available(macOS, deprecated: 26, message: "use GlassEffectContainer(spacing:content:)")
  @ViewBuilder func glassEffectContainer(spacing: CGFloat? = nil) -> some View {
    if #available(macOS 26, *) {
      GlassEffectContainer(spacing: spacing) { content }
    } else {
      content
    }
  }
}
