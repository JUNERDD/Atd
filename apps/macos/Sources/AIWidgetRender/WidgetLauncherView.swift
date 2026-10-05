import AIWidgetModel
import AppKit
import SwiftUI
import WidgetKit

/// One app of the "My Apps" launcher, ready to draw.
public struct WidgetLauncherTile: Identifiable, Sendable {
  public enum Icon: Sendable {
    /// The app's icon, already drawn into a square bitmap (``WidgetLauncherLayout/iconPixels``).
    case image(CGImage)
    /// An SF Symbol on a tile filled with the app's accent: `app.fill` for an app whose icon is
    /// missing or could not be drawn, and the gallery's sample apps.
    case symbol(String)
  }

  /// The app id.
  public let id: String
  public let name: String
  public let accent: WidgetAccent?
  public let icon: Icon
  /// What a click on the tile opens; nil leaves it inert, as for the gallery's samples.
  public let url: URL?

  public init(id: String, name: String, accent: WidgetAccent?, icon: Icon, url: URL?) {
    self.id = id
    self.name = name
    self.accent = accent
    self.icon = icon
    self.url = url
  }
}

/// The "My Apps" launcher: the apps as tiles on the family's fixed grid
/// (``WidgetLauncherLayout``), each a `Link` to its app. Cells without an app stay empty, so the
/// grid keeps its place like a Home Screen page as apps come and go. It draws resolved tiles
/// only, so the extension and an off-screen renderer show the same thing; the container
/// background and what a click between tiles opens belong to the widget.
public struct WidgetLauncherView: View {
  private let tiles: [WidgetLauncherTile]
  private let layout: WidgetLauncherLayout

  public init(tiles: [WidgetLauncherTile], layout: WidgetLauncherLayout) {
    self.tiles = Array(tiles.prefix(layout.capacity))
    self.layout = layout
  }

  public var body: some View {
    VStack(spacing: 0) {
      ForEach(0..<layout.rows, id: \.self) { row in
        HStack(spacing: 0) {
          ForEach(0..<layout.columns, id: \.self) { column in
            cell(row * layout.columns + column)
              .frame(maxWidth: .infinity, maxHeight: .infinity)
          }
        }
      }
    }
  }

  @ViewBuilder
  private func cell(_ index: Int) -> some View {
    if tiles.indices.contains(index) {
      let tile = tiles[index]
      if let url = tile.url {
        Link(destination: url) { WidgetLauncherTileView(tile: tile, layout: layout) }
      } else {
        WidgetLauncherTileView(tile: tile, layout: layout)
      }
    } else {
      Color.clear
    }
  }
}

/// A tile: the icon, then the app's name in one truncating line when the family shows names. It
/// fills its grid cell, so the whole cell is the click target.
private struct WidgetLauncherTileView: View {
  let tile: WidgetLauncherTile
  let layout: WidgetLauncherLayout

  var body: some View {
    VStack(spacing: 4) {
      WidgetLauncherIconView(icon: tile.icon, accent: tile.accent)
        .frame(maxWidth: layout.iconSide, maxHeight: layout.iconSide)
      if layout.showsNames {
        Text(verbatim: tile.name)
          .font(.subheadline)
          .foregroundStyle(.primary)
          .lineLimit(1)
          .padding(.horizontal, 3)
      }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .contentShape(.rect)
    .accessibilityElement(children: .ignore)
    .accessibilityLabel(Text(verbatim: tile.name))
  }
}

/// The icon in the app icon shape, or a symbol on the app's accent (gray without one). Full color
/// keeps an icon's own colors. The accented and vibrant modes paint the whole widget in one or two
/// tones, so an icon is desaturated there rather than reduced to a flat silhouette, and a symbol
/// tile becomes a faint fill under an opaque glyph, which stays legible once both turn one color.
private struct WidgetLauncherIconView: View {
  let icon: WidgetLauncherTile.Icon
  let accent: WidgetAccent?
  @Environment(\.widgetRenderingMode) private var renderingMode

  var body: some View {
    GeometryReader { proxy in
      let side = min(proxy.size.width, proxy.size.height)
      content(side: side)
        .frame(width: side, height: side)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
    .aspectRatio(1, contentMode: .fit)
  }

  @ViewBuilder
  private func content(side: CGFloat) -> some View {
    // The app icon shape: a continuous rounded square whose radius is 22.37% of its side.
    let shape = RoundedRectangle(cornerRadius: side * 0.2237, style: .continuous)
    switch icon {
    case .image(let image):
      Image(decorative: image, scale: 2)
        .resizable()
        .interpolation(.high)
        .widgetAccentedRenderingMode(.desaturated)
        .clipShape(shape)
    case .symbol(let name):
      shape.fill(fill)
        .overlay {
          Image(systemName: name)
            .font(.system(size: side * 0.46, weight: .semibold))
            .foregroundStyle(glyph)
        }
    }
  }

  private var fill: Color {
    guard renderingMode == .fullColor else { return .primary.opacity(0.2) }
    guard let accent else { return Color(nsColor: .systemGray) }
    return Color(.sRGB, red: accent.red, green: accent.green, blue: accent.blue)
  }

  private var glyph: Color {
    guard renderingMode == .fullColor else { return .primary }
    return accent?.prefersDarkContent == true ? .black : .white
  }
}
