import AICore
import SwiftUI

/// The lightboxes' one side panel (``IslandMetrics/lightboxPanel(shown:in:between:)``): the
/// recording's steps and the long screenshot's text commands' result, on the shell's glass pinned
/// dark like the bars. A header row (the title, an optional info glyph whose tooltip says more,
/// the content's tools, and last the hide button), a body that scrolls past its height with the
/// floating surfaces' edge fades where content continues and no scroll bar
/// (``FloatingScrollEdges``), keeping the newest content in view while it streams in (`follows`),
/// and an optional footer pinned at the bottom. Its content gets the body's scroll proxy, to keep
/// a row in view or start a page at its top.
///
/// The whole outline takes the pointer, so a click between its rows never reaches the scrim or
/// the media under it.
struct IslandLightboxPanel<Tools: View, Content: View, Footer: View>: View {
  let title: String
  /// The info glyph beside the title and what its tooltip says.
  var info: (glyph: String, text: String)?
  /// The hide button's name.
  let hide: String
  let reduceMotion: Bool
  /// The content is streaming in (``FloatingScrollEdges/follows``).
  var follows = false
  let onHide: () -> Void
  @ViewBuilder let tools: () -> Tools
  @ViewBuilder let content: (ScrollViewProxy) -> Content
  @ViewBuilder let footer: () -> Footer

  var body: some View {
    let outline = RoundedRectangle(
      cornerRadius: IslandMetrics.lightboxPanelRadius, style: .continuous)
    VStack(alignment: .leading, spacing: 0) {
      header
      ScrollViewReader { proxy in
        ScrollView(.vertical) {
          content(proxy).frame(maxWidth: .infinity, alignment: .topLeading)
        }
        .modifier(FloatingScrollEdges(reduceMotion: reduceMotion, follows: follows))
      }
      .frame(maxHeight: .infinity, alignment: .top)
      footer()
    }
    .padding(IslandMetrics.cardPadding)
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    .glassSurface(in: outline, animation: nil, dark: true)
    .contentShape(outline)
    .accessibilityElement(children: .contain)
    .accessibilityLabel(Text(verbatim: title))
  }

  private var header: some View {
    HStack(spacing: 4) {
      Text(verbatim: title)
        .font(.system(size: 12, weight: .semibold))
        .foregroundStyle(.secondary)
        .lineLimit(1)
        .truncationMode(.tail)
        .help(title)
        .accessibilityAddTraits(.isHeader)
      if let info {
        IslandGlyph(name: info.glyph, side: 13)
          .foregroundStyle(.secondary)
          .help(info.text)
          .accessibilityHidden(false)
          .accessibilityLabel(Text(verbatim: info.text))
      }
      Spacer(minLength: 8)
      tools()
      IslandIconButton(glyph: IslandIcons.panelClose, label: hide, action: onHide)
    }
    .padding(.leading, IslandMetrics.rowPadding)
    .frame(height: IslandMetrics.headerHeight)
  }
}

extension IslandLightboxPanel where Footer == EmptyView {
  init(
    title: String, info: (glyph: String, text: String)? = nil, hide: String, reduceMotion: Bool,
    onHide: @escaping () -> Void, @ViewBuilder tools: @escaping () -> Tools,
    @ViewBuilder content: @escaping (ScrollViewProxy) -> Content
  ) {
    self.init(
      title: title, info: info, hide: hide, reduceMotion: reduceMotion, onHide: onHide,
      tools: tools, content: content, footer: { EmptyView() })
  }
}

/// Stands a lightbox's side panel where its placement puts it, docked or a drawer; nothing while
/// it is hidden. It comes in from the right as it shows.
struct IslandLightboxPanelSlot<Panel: View>: View {
  let placement: IslandMetrics.LightboxPanelPlacement
  @ViewBuilder let panel: () -> Panel

  var body: some View {
    if let frame = placement.frame {
      panel()
        .frame(width: frame.width, height: frame.height)
        .position(x: frame.midX, y: frame.midY)
        .transition(.opacity.combined(with: .offset(x: 24)))
    }
  }
}

/// Under a drawer, over the media and the scrim but under the bars: a click outside the drawer
/// closes it rather than reaching what it would (playing, picking, closing the lightbox).
struct IslandLightboxDrawerCatcher: View {
  let onDismiss: () -> Void

  var body: some View {
    Color.clear
      .contentShape(Rectangle())
      .onTapGesture(perform: onDismiss)
      .accessibilityHidden(true)
  }
}

/// The top bar's toggle of the side panel, in both lightboxes before Back: the `panel-right`
/// glyph and the content's name, selected (on the wash) while the panel shows, its tooltip naming
/// ⌥⌘I. While hidden it carries a dot when something new waits in the panel (`dot`).
struct IslandLightboxPanelToggle: View {
  let title: String
  let tooltip: String
  let shown: Bool
  var dot = false
  let action: () -> Void

  var body: some View {
    IslandTextButton(
      title: title, tooltip: tooltip, rest: shown ? 0.1 : 0, glyph: IslandIcons.panel,
      action: action
    )
    .overlay(alignment: .topLeading) {
      if dot && !shown {
        Circle()
          .fill(Color.accentColor)
          .frame(width: 6, height: 6)
          .padding(.leading, 21)
          .padding(.top, 6)
          .allowsHitTesting(false)
          .accessibilityHidden(true)
      }
    }
    .accessibilityAddTraits(shown ? .isSelected : [])
  }

  /// The toggle's width for `title`, for a bar that chooses its row by width: the label's
  /// padding, its glyph and gap, and the title.
  static func width(of title: String) -> Double {
    20 + 14 + 6 + IslandType.width(of: title, limit: 200)
  }
}

/// The side panel's glyphs: Lucide's `panel-right` on the top bar's toggle and
/// `panel-right-close` on the panel's hide button, template image sets in
/// `App/Assets.xcassets/Island` carrying the paths of the installed `lucide-react` 1.61.0 (ISC).
extension IslandIcons {
  static let panel = "panel-right"
  static let panelClose = "panel-right-close"
}
