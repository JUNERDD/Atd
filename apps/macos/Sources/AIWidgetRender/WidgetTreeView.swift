import AICore
import AIWidgetModel
import Charts
import SwiftUI

/// What a rendering needs besides the tree: the images it references and where a `link` goes.
/// The extension reads images from the widget files and links with the build's URL scheme; the
/// shell's preview passes the same.
public struct WidgetRenderContext: Sendable {
  /// The decoded image for an `image` node's `src`, or nil to show a placeholder.
  public var image: @Sendable (String) -> NSImage?
  /// The URL a `link` node to `route` opens, or nil to leave the child inert.
  public var link: @Sendable (String) -> URL?

  public init(
    image: @escaping @Sendable (String) -> NSImage?, link: @escaping @Sendable (String) -> URL?
  ) {
    self.image = image
    self.link = link
  }

  public static let inert = WidgetRenderContext(image: { _ in nil }, link: { _ in nil })
}

/// Draws a widget view tree (`widgets.ts`) natively. Every node maps to one SwiftUI view; nothing
/// the tree says can run code, load from the network or reach outside the app's own files.
/// Rendering stops below ``WidgetContract/maxDepth`` so a tree that slipped past the service's
/// check cannot recurse without bound.
public struct WidgetTreeView: View {
  private let node: WidgetNode
  private let context: WidgetRenderContext
  private let level: Int
  @Environment(\.widgetAccentColor) private var accent

  public init(_ node: WidgetNode, context: WidgetRenderContext) {
    self.init(node, context: context, level: 1)
  }

  private init(_ node: WidgetNode, context: WidgetRenderContext, level: Int) {
    self.node = node
    self.context = context
    self.level = level
  }

  public var body: some View {
    if level > WidgetContract.maxDepth {
      EmptyView()
    } else {
      content
    }
  }

  private func child(_ node: WidgetNode) -> WidgetTreeView {
    WidgetTreeView(node, context: context, level: level + 1)
  }

  private func children(_ nodes: [WidgetNode]) -> some View {
    ForEach(Array(nodes.enumerated()), id: \.offset) { _, node in child(node) }
  }

  @ViewBuilder
  private var content: some View {
    switch node {
    case .vstack(let stack):
      VStack(
        alignment: stack.alignment?.alignment ?? .leading,
        spacing: stack.spacing.map { CGFloat($0) }
      ) {
        children(stack.children)
      }
      .stackChrome(padding: stack.padding, background: stack.background, accent: accent)
    case .hstack(let stack):
      HStack(
        alignment: stack.alignment?.alignment ?? .center, spacing: stack.spacing.map { CGFloat($0) }
      ) {
        children(stack.children)
      }
      .stackChrome(padding: stack.padding, background: stack.background, accent: accent)
    case .zstack(let stack):
      ZStack(alignment: stack.alignment?.alignment ?? .center) { children(stack.children) }
        .stackChrome(padding: stack.padding, background: stack.background, accent: accent)
    case .spacer(let spacer):
      Spacer(minLength: spacer.minLength.map { CGFloat($0) })
    case .divider:
      Divider()
    case .text(let text):
      Text(verbatim: text.text)
        .font((text.style ?? .body).font)
        .fontWeight(text.weight?.weight)
        .lineLimit(text.lineLimit)
        .foreground(text.color, accent: accent)
    case .symbol(let symbol):
      Image(systemName: symbol.name)
        .font(.system(size: symbol.size ?? 17))
        .foreground(symbol.color, accent: accent)
    case .image(let image):
      WidgetImageView(image: image, loaded: context.image(image.src))
    case .gauge(let gauge):
      WidgetGaugeView(gauge: gauge)
    case .progress(let progress):
      WidgetMeter(
        fraction: progress.value, label: progress.label, color: progress.color, circular: false)
    case .date(let date):
      WidgetDateView(date: date)
    case .list(let list):
      WidgetListView(rows: list.rows)
    case .chart(let chart):
      WidgetChartView(chart: chart)
    case .link(let link):
      if let url = context.link(link.route) {
        Link(destination: url) { child(link.child) }
      } else {
        child(link.child)
      }
    }
  }
}

private struct WidgetImageView: View {
  let image: WidgetNode.Image
  let loaded: NSImage?

  var body: some View {
    Group {
      if let loaded {
        Image(nsImage: loaded).resizable()
          .aspectRatio(contentMode: image.contentMode == .fill ? .fill : .fit)
      } else {
        Image(systemName: "photo").foregroundStyle(.secondary)
      }
    }
    .frame(width: image.width.map { CGFloat($0) }, height: image.height.map { CGFloat($0) })
    .clipped()
  }
}

/// A gauge as a ``WidgetMeter``: its value as a fraction of its range.
private struct WidgetGaugeView: View {
  let gauge: WidgetNode.Gauge

  var body: some View {
    let lower = gauge.min ?? 0
    let upper = max(gauge.max ?? 1, lower + .ulpOfOne)
    let fraction = (min(max(gauge.value, lower), upper) - lower) / (upper - lower)
    WidgetMeter(
      fraction: fraction, label: gauge.label, color: gauge.color,
      circular: gauge.style == .circular)
  }
}

/// Progress and gauges drawn from shapes, not `ProgressView` or `Gauge`: those are AppKit-backed
/// on macOS and `ImageRenderer` draws them as an "unsupported" placeholder, so the shell's
/// preview would differ from the widget.
private struct WidgetMeter: View {
  let fraction: Double
  let label: String?
  let color: WidgetColor?
  let circular: Bool
  @Environment(\.widgetAccentColor) private var accent

  var body: some View {
    let tint = color?.color(accent: accent) ?? accent
    let done = min(max(fraction, 0), 1)
    if circular {
      ZStack {
        Circle().stroke(tint.opacity(0.2), lineWidth: 5)
        Circle().trim(from: 0, to: done)
          .stroke(tint, style: StrokeStyle(lineWidth: 5, lineCap: .round))
          .rotationEffect(.degrees(-90))
        if let label { Text(verbatim: label).font(.footnote).lineLimit(1).padding(6) }
      }
      .frame(width: 52, height: 52)
    } else {
      VStack(alignment: .leading, spacing: 4) {
        if let label { Text(verbatim: label).font(.footnote).lineLimit(1) }
        Capsule().fill(tint.opacity(0.2)).frame(height: 6)
          .overlay(alignment: .leading) {
            GeometryReader { proxy in
              Capsule().fill(tint).frame(width: proxy.size.width * done)
            }
          }
      }
    }
  }
}

private struct WidgetDateView: View {
  let date: WidgetNode.Date
  @Environment(\.widgetAccentColor) private var accent

  var body: some View {
    if let value = BridgeCoding.parseDateTime(date.date) {
      Text(value, style: style)
        .font((date.textStyle ?? .body).font)
        .foreground(date.color, accent: accent)
    }
  }

  private var style: Text.DateStyle {
    switch date.style {
    case .relative: .relative
    case .time: .time
    case .timer: .timer
    }
  }
}

private struct WidgetListView: View {
  let rows: [WidgetListRow]
  @Environment(\.widgetAccentColor) private var accent

  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
        HStack(spacing: 8) {
          if let symbol = row.symbol {
            Image(systemName: symbol).foregroundStyle(row.color?.color(accent: accent) ?? accent)
          }
          VStack(alignment: .leading, spacing: 1) {
            Text(verbatim: row.title).font(.subheadline).lineLimit(1)
            if let subtitle = row.subtitle {
              Text(verbatim: subtitle).font(.footnote).foregroundStyle(.secondary).lineLimit(1)
            }
          }
          Spacer(minLength: 4)
          if let trailing = row.trailing {
            Text(verbatim: trailing).font(.footnote).foregroundStyle(.secondary).lineLimit(1)
          }
        }
      }
    }
  }
}

private struct WidgetChartView: View {
  let chart: WidgetNode.Chart
  @Environment(\.widgetAccentColor) private var accent

  var body: some View {
    let points = Array(chart.points.enumerated())
    Chart(points, id: \.offset) { _, point in
      switch chart.kind {
      case .line:
        LineMark(x: .value("x", point.x), y: .value("y", point.y))
      case .bar:
        BarMark(x: .value("x", point.x), y: .value("y", point.y))
      }
    }
    .foregroundStyle(chart.color?.color(accent: accent) ?? accent)
    .chartYAxis(.hidden)
  }
}
