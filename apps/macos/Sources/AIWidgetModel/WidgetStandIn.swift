import Foundation

/// What stands in for an app widget that has no render yet, built as a view tree so it draws with
/// the same renderer as a snapshot (``WidgetTreeView``): the widget gallery shows it, and so does
/// a desktop pin until its first render arrives. It has no links.
public enum WidgetStandIn {
  /// The app's name and the widget's title under a mark in the app's accent, so the stand-in
  /// shows whose widget it is.
  public static func branded(appName: String, title: String, family: WidgetFamily) -> WidgetNode {
    let mark = WidgetNode.symbol(
      .init(name: "app.fill", size: family == .systemSmall ? 28 : 34, color: .accent))
    let name = WidgetNode.text(
      .init(text: appName, style: .headline, weight: nil, color: nil, lineLimit: 1))
    let detail = WidgetNode.text(
      .init(text: title, style: .footnote, weight: nil, color: .secondary, lineLimit: 2))
    return .vstack(
      .init(
        alignment: .leading, children: [mark, .spacer(.init(minLength: 0)), name, detail],
        spacing: 2, padding: nil, background: nil))
  }
}
