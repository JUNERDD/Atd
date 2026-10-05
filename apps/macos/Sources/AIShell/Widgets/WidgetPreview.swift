import AICore
import AIWidgetModel
import AIWidgetRender
import AppKit
import SwiftUI

/// Renders a widget's latest synced snapshot to PNG for the renderer's cards and settings, with
/// the same ``WidgetTreeView``, image copies and app accent the extension uses, so the preview
/// shows what the desktop widget shows. Links are inert in a picture.
enum WidgetPreview {
  /// The family's size in points, as macOS lays desktop widgets out.
  static func size(of family: WidgetFamily) -> CGSize {
    switch family {
    case .systemSmall: CGSize(width: 170, height: 170)
    case .systemMedium: CGSize(width: 364, height: 170)
    case .systemLarge: CGSize(width: 364, height: 382)
    }
  }

  /// Base64 PNG at twice the point size, in the app's current appearance. Rejects when the shell
  /// holds no readable snapshot, or none of its entries is due or upcoming.
  static func png(files: WidgetFiles, appId: String, widgetId: String, family: WidgetFamily)
    throws(BridgeError) -> String
  {
    guard
      case .success(let snapshot) = files.readSnapshot(
        appId: appId, widgetId: widgetId, family: family),
      let entry = WidgetTimelinePlan.entries(of: snapshot.timeline, now: .now).first
    else { throw BridgeError("No preview of this widget is available.") }
    let context = WidgetRenderContext(
      image: { src in
        let url = files.imageURL(appId: appId, src: src)
        guard let data = try? Data(contentsOf: url), data.count <= WidgetContract.imageMaxBytes
        else { return nil }
        return NSImage(data: data)
      }, link: { _ in nil })
    let size = size(of: family)
    let dark = NSApp.effectiveAppearance.bestMatch(from: [.aqua, .darkAqua]) == .darkAqua
    let accent = (try? files.readCatalog().get())?.apps.first { $0.appId == appId }?.accent
    let view = WidgetTreeView(entry.view, context: context)
      .widgetAccent(accent)
      .padding(16)
      .frame(width: size.width, height: size.height, alignment: .topLeading)
      .background(.fill.tertiary, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
      .background(
        Color(nsColor: .windowBackgroundColor),
        in: RoundedRectangle(cornerRadius: 22, style: .continuous)
      )
      .environment(\.colorScheme, dark ? .dark : .light)
    let renderer = ImageRenderer(content: view)
    renderer.scale = 2
    guard let image = renderer.cgImage,
      let png = NSBitmapImageRep(cgImage: image).representation(using: .png, properties: [:])
    else { throw BridgeError("The widget preview could not be drawn.") }
    return png.base64EncodedString()
  }
}
