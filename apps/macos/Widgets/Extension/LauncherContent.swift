import AIWidgetModel
import AIWidgetRender
import Foundation
import WidgetKit

/// The launcher's tiles: the user's apps from the files the shell writes (``WidgetFiles``), most
/// recently updated first, or the gallery's samples. The extension never talks to the service.
enum LauncherContent {
  static func layout(_ family: WidgetKit.WidgetFamily) -> WidgetLauncherLayout {
    WidgetLauncherLayout(family: AIWidgetModel.WidgetFamily(family) ?? .systemSmall)
  }

  /// As many of the user's apps as `family` shows. `tiles` is nil while there are none; `read` is
  /// false when the shell has written no launcher file yet or it does not decode.
  static func current(family: WidgetKit.WidgetFamily) -> (tiles: [WidgetLauncherTile]?, read: Bool)
  {
    guard let files = WidgetFiles.forMainBundle(), case .success(let file) = files.readLauncher()
    else { return (nil, false) }
    let shown = makeTiles(file.apps, layout: layout(family), files: files)
    return (shown.isEmpty ? nil : shown, true)
  }

  /// The gallery's preview: the user's apps when there are any, else the samples.
  static func gallery(family: WidgetKit.WidgetFamily) -> [WidgetLauncherTile] {
    current(family: family).tiles ?? samples
  }

  /// A tile opens its app at its start page. An icon that is missing or does not draw leaves the
  /// app's fallback tile.
  private static func makeTiles(
    _ apps: [WidgetLauncherApp], layout: WidgetLauncherLayout, files: WidgetFiles
  ) -> [WidgetLauncherTile] {
    let scheme = WidgetLink.mainBundleScheme
    return apps.prefix(layout.capacity).map { app in
      let image = files.readIcon(appId: app.appId).flatMap {
        LauncherIconRasterizer.image(svg: $0, pixels: layout.iconPixels)
      }
      return WidgetLauncherTile(
        id: app.appId, name: app.name, accent: app.accent,
        icon: image.map { .image($0) } ?? .symbol("app.fill"),
        url: scheme.flatMap { WidgetLink.url(scheme: $0, appId: app.appId, route: nil) })
    }
  }

  /// The gallery's stand-in while the user has no apps: the kind of small apps Atd makes, each a
  /// symbol on its own color, enough to fill the large grid, so every size's preview shows what
  /// the launcher is for. Their links are inert.
  static var samples: [WidgetLauncherTile] {
    let apps: [(name: String.LocalizationValue, symbol: String, color: String)] = [
      ("launcher.sample.notes", "note.text", "#B45309"),
      ("launcher.sample.timer", "timer", "#DC2626"),
      ("launcher.sample.habits", "checkmark", "#15803D"),
      ("launcher.sample.weather", "cloud.sun.fill", "#2563EB"),
      ("launcher.sample.dice", "dice.fill", "#7C3AED"),
      ("launcher.sample.budget", "chart.pie.fill", "#0F766E"),
      ("launcher.sample.recipes", "fork.knife", "#C2410C"),
      ("launcher.sample.reading", "book.fill", "#4F46E5"),
      ("launcher.sample.water", "drop.fill", "#0369A1"),
      ("launcher.sample.workout", "figure.run", "#BE123C"),
      ("launcher.sample.flashcards", "rectangle.stack.fill", "#9333EA"),
      ("launcher.sample.shopping", "cart.fill", "#047857"),
      ("launcher.sample.focus", "hourglass", "#B91C1C"),
      ("launcher.sample.journal", "pencil.line", "#A16207"),
      ("launcher.sample.music", "music.note", "#BE185D"),
      ("launcher.sample.calculator", "plus.forwardslash.minus", "#475569"),
    ]
    return apps.enumerated().map { index, app in
      WidgetLauncherTile(
        id: "sample-\(index)", name: String(localized: app.name),
        accent: WidgetAccent(hex: app.color), icon: .symbol(app.symbol), url: nil)
    }
  }
}
