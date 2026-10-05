import AIWidgetModel
import Foundation
import WidgetKit

/// What the gallery shows in place of an app widget's render, built as view trees so they draw
/// with the same renderer (``WidgetTreeView``). Their links are inert.
enum GallerySample {
  /// The stand-in for an app widget with no render yet: the app's name and the widget's title
  /// under a mark in the app's accent, so the gallery shows whose widget it is.
  static func branded(appName: String, title: String, family: WidgetKit.WidgetFamily)
    -> WidgetNode
  {
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

  /// A notes app's day at a glance, for the gallery while no app declares a widget.
  static func example(family: WidgetKit.WidgetFamily) -> WidgetNode {
    let text = { (key: String.LocalizationValue) in String(localized: key) }
    let header = WidgetNode.hstack(
      .init(
        alignment: .center,
        children: [
          .symbol(.init(name: "note.text", size: 15, color: .accent)),
          .text(
            .init(
              text: text("widget.sample.title"), style: .headline, weight: nil, color: nil,
              lineLimit: 1)),
        ], spacing: 6, padding: nil, background: nil))
    let count = WidgetNode.text(
      .init(
        text: text("widget.sample.count"), style: .title2, weight: .bold, color: nil, lineLimit: 1)
    )
    let rows = [
      WidgetListRow(
        title: text("widget.sample.row1"), subtitle: nil, symbol: "circle", trailing: nil,
        color: nil),
      WidgetListRow(
        title: text("widget.sample.row2"), subtitle: nil, symbol: "circle", trailing: nil,
        color: nil),
      WidgetListRow(
        title: text("widget.sample.row3"), subtitle: nil, symbol: "checkmark.circle.fill",
        trailing: nil, color: .success),
    ]
    var children = [header, count]
    if family != .systemSmall {
      children += [.divider(.init()), .list(.init(rows: rows))]
    }
    children.append(.spacer(.init(minLength: 0)))
    return .vstack(
      .init(alignment: .leading, children: children, spacing: 8, padding: nil, background: nil))
  }
}
