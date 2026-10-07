import AIWidgetModel
import AIWidgetRender
import SwiftUI
import WidgetKit

/// One entry: an app's tree, a gallery stand-in, or a readable state. The `accent` token takes
/// the entry's app accent color.
struct AppWidgetView: View {
  let entry: AppWidgetEntry
  @Environment(\.widgetFamily) private var family

  var body: some View {
    content
      .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
      .widgetAccent(accent)
      .containerBackground(.fill.tertiary, for: .widget)
      .widgetURL(url)
  }

  @ViewBuilder
  private var content: some View {
    switch entry.state {
    case .content(let appId, let view, _, _):
      WidgetTreeView(view, context: Self.context(appId: appId))
    case .branded(let appName, let title, _):
      let standIn = WidgetStandIn.branded(
        appName: appName, title: title, family: AIWidgetModel.WidgetFamily(family) ?? .systemSmall)
      WidgetTreeView(standIn, context: .inert)
    case .example:
      WidgetTreeView(GallerySample.example(family: family), context: .inert)
    case .chooseApp:
      message("square.grid.2x2", "widget.state.choose.title", "widget.state.choose.message")
    case .noApps:
      message("square.grid.2x2", "widget.state.choose.title", "widget.state.noApps.message")
    case .gone:
      message("questionmark.app", nil, "widget.state.gone.message")
    case .unsupportedSize:
      message("rectangle.dashed", nil, "widget.state.size.message")
    case .waiting:
      message("clock", nil, "widget.state.waiting.message")
    case .unreadable:
      message("exclamationmark.triangle", nil, "widget.state.unreadable.message")
    }
  }

  private func message(
    _ symbol: String, _ title: String.LocalizationValue?, _ text: String.LocalizationValue
  )
    -> some View
  {
    WidgetMessageView(
      symbol: symbol, title: title.map { String(localized: $0) }, message: String(localized: text))
  }

  private var accent: WidgetAccent? {
    switch entry.state {
    case .content(_, _, _, let accent), .branded(_, _, let accent): accent
    default: nil
    }
  }

  /// A tap anywhere opens the app at the entry's route. Every other state (the gallery
  /// stand-ins, choosing an app, no apps, a deleted app, a missing size, no content yet,
  /// unreadable content) opens Atd's task panel, where the user can create or open apps.
  private var url: URL? {
    guard let scheme = WidgetLink.mainBundleScheme else { return nil }
    guard case .content(let appId, _, let route, _) = entry.state else {
      return WidgetLink.panelURL(scheme: scheme)
    }
    return WidgetLink.url(scheme: scheme, appId: appId, route: route ?? "/")
  }

  /// Images come from the copies the shell placed beside the snapshots, never the app's version
  /// directory, which the sandbox cannot read; links open the app at their route.
  static func context(appId: String) -> WidgetRenderContext {
    let files = WidgetFiles.forMainBundle()
    let scheme = WidgetLink.mainBundleScheme
    return WidgetRenderContext(
      image: { src in
        guard let url = files?.imageURL(appId: appId, src: src),
          let data = try? Data(contentsOf: url), data.count <= WidgetContract.imageMaxBytes
        else { return nil }
        return NSImage(data: data)
      },
      link: { route in scheme.flatMap { WidgetLink.url(scheme: $0, appId: appId, route: route) } })
  }
}
