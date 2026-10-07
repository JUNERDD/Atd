import AICore
import AIWidgetModel
import AIWidgetRender
import AppKit
import SwiftUI

/// Renders a widget's latest synced snapshot to PNG for the renderer's cards and settings, with
/// the same ``WidgetTreeView``, image copies, app accent and card (``WidgetCardView``) the
/// extension and the desktop pins use, so the preview shows what the desktop shows. Links are
/// inert in a picture.
enum WidgetPreview {
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
    let accent = (try? files.readCatalog().get())?.apps.first { $0.appId == appId }?.accent
    let context = Self.context(files: files, appId: appId) { _ in nil }
    let view = WidgetCardView(family: family) {
      WidgetTreeView(entry.view, context: context).widgetAccent(accent)
    }
    guard let image = Self.image(of: view),
      let png = NSBitmapImageRep(cgImage: image).representation(using: .png, properties: [:])
    else { throw BridgeError("The widget preview could not be drawn.") }
    return png.base64EncodedString()
  }

  /// What a widget tree of `appId` draws with in the shell: images from the copies the shell
  /// placed beside the snapshots (at most ``WidgetContract/imageMaxBytes``, decoded by AppKit
  /// after the writer's PNG or JPEG signature check), and `link` for its links.
  static func context(
    files: WidgetFiles, appId: String, link: @escaping @Sendable (String) -> URL?
  ) -> WidgetRenderContext {
    WidgetRenderContext(
      image: { src in
        let url = files.imageURL(appId: appId, src: src)
        guard let data = try? Data(contentsOf: url), data.count <= WidgetContract.imageMaxBytes
        else { return nil }
        return NSImage(data: data)
      }, link: link)
  }

  /// The view drawn at twice its point size in the app's current appearance, which an off-screen
  /// renderer does not inherit.
  static func image(of view: some View) -> CGImage? {
    let dark = NSApp.effectiveAppearance.bestMatch(from: [.aqua, .darkAqua]) == .darkAqua
    let renderer = ImageRenderer(content: view.environment(\.colorScheme, dark ? .dark : .light))
    renderer.scale = 2
    return renderer.cgImage
  }
}
