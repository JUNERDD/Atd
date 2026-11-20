import AtdInk
import AtdMiniApps
import SwiftUI
import WidgetKit

/// 小组件: the app's widget as the Home Screen shows it, in either size, and whether it is on
/// the Home Screen. iOS lets only the person add a widget, so 添加到主屏幕 shows how; a widget
/// added without choosing an app shows the one opened last, which is this one.
struct WidgetPanel: View {
  let app: MiniApp
  let glance: MiniAppGlance
  var guiding = false
  @State private var size = MiniAppText.string("widget.small")
  @State private var onHome = false
  @State private var showsGuide = false
  @Environment(\.scenePhase) private var scenePhase

  var body: some View {
    ScrollView {
      VStack(spacing: 14) {
        WidgetWall {
          WidgetPreviewFrame(glance: glance, family: family)
        }
        InkSegmented(
          label: MiniAppText.string("widget.size"), choices: sizes, selection: $size
        )
        .frame(maxWidth: 240)
        if onHome {
          Label(MiniAppText.string("widget.onHome"), systemImage: "checkmark.circle")
            .font(.body.weight(.medium))
            .frame(maxWidth: .infinity, minHeight: 44)
        } else if showsGuide || guiding {
          AddWidgetGuide(name: app.name)
            .padding(.top, 6)
        } else {
          Button {
            showsGuide = true
          } label: {
            Label(MiniAppText.string("preview.addToHome"), systemImage: "plus.square")
          }
          .buttonStyle(InkButtonStyle())
        }
      }
      .padding(.horizontal, 16)
      .padding(.top, 8)
    }
    .task(id: scenePhase) {
      // Back from the Home Screen, the widget may be there now.
      if scenePhase == .active { onHome = await Self.isOnHomeScreen(app.id) }
    }
  }

  private var sizes: [String] {
    [MiniAppText.string("widget.small"), MiniAppText.string("widget.medium")]
  }

  private var family: MiniAppGlanceFamily {
    size == MiniAppText.string("widget.medium") ? .medium : .small
  }

  /// Whether a Home Screen widget shows this app: one configured with it, or one left on the
  /// default while it is the app opened last.
  static func isOnHomeScreen(_ appID: String) async -> Bool {
    guard let widgets = try? await WidgetCenter.shared.currentConfigurations() else {
      return false
    }
    let recent = MiniAppsModel.shared.library.recentID
    return widgets.contains { widget in
      guard widget.kind == MiniApps.widgetKind,
        widget.family == .systemSmall || widget.family == .systemMedium
      else { return false }
      let chosen = widget.widgetConfigurationIntent(of: MiniAppWidgetIntent.self)?.app?.id
      return (chosen ?? recent) == appID
    }
  }
}

/// A piece of Home Screen wallpaper for a widget preview to sit on.
struct WidgetWall<Content: View>: View {
  var height: CGFloat = 196
  @ViewBuilder let content: Content
  @Environment(\.colorScheme) private var scheme

  var body: some View {
    content
      .frame(maxWidth: .infinity, minHeight: height)
      .background {
        ZStack {
          LinearGradient(
            colors: [Wallpaper.top, Wallpaper.bottom], startPoint: .top, endPoint: .bottom)
          glow(Wallpaper.peach, at: UnitPoint(x: 0.18, y: 0.06), radius: 260)
          glow(Wallpaper.pink, at: UnitPoint(x: 0.92, y: 0.26), radius: 200)
          glow(Wallpaper.violet, at: UnitPoint(x: 0.5, y: 1.04), radius: 300)
        }
        .colorMultiply(Color(white: scheme == .dark ? 0.62 : 1))
      }
      .clipShape(RoundedRectangle(cornerRadius: 28, style: .continuous))
  }

  private func glow(_ color: Color, at center: UnitPoint, radius: CGFloat) -> some View {
    RadialGradient(
      colors: [color, color.opacity(0)], center: center, startRadius: 0, endRadius: radius)
  }
}

/// The prototype's wallpaper, which stands for the person's own.
private enum Wallpaper {
  static let peach = Color(red: 1, green: 0.702, blue: 0.478)
  static let pink = Color(red: 1, green: 0.478, blue: 0.635)
  static let violet = Color(red: 0.357, green: 0.247, blue: 0.82)
  static let top = Color(red: 0.227, green: 0.165, blue: 0.525)
  static let bottom = Color(red: 0.114, green: 0.086, blue: 0.282)
}

/// A widget as the Home Screen draws it: the glance on paper in a widget's shape. Its buttons do
/// nothing here.
struct WidgetPreviewFrame: View {
  let glance: MiniAppGlance
  let family: MiniAppGlanceFamily

  var body: some View {
    MiniAppGlanceView(glance: glance, family: family)
      .environment(\.miniAppGlanceStyle, .fullColor)
      .padding(16)
      .frame(width: family == .medium ? 338 : 158, height: 158)
      .background(InkColor.paper, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
      .allowsHitTesting(false)
      .accessibilityElement(children: .ignore)
      .accessibilityLabel(MiniAppText.string("widget.preview \(glance.label)"))
  }
}

/// How to add the widget, which only the person can do on iOS. A widget added this way shows
/// the app opened last, so it needs no choosing.
struct AddWidgetGuide: View {
  let name: String
  var done: (() -> Void)?

  var body: some View {
    VStack(alignment: .leading, spacing: 14) {
      ForEach(Self.steps.indices, id: \.self) { index in
        HStack(alignment: .top, spacing: 12) {
          Text(verbatim: "\(index + 1)")
            .font(.subheadline.weight(.semibold))
            .frame(width: 28, height: 28)
            .background(
              InkShape(corners: .round, seed: index).stroke(InkColor.line, lineWidth: 1.2)
            )
            .accessibilityHidden(true)
          Text(Self.steps[index])
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.top, 3)
        }
        .accessibilityElement(children: .combine)
      }
      Text(MiniAppText.string("guide.shows \(name)"))
        .font(.footnote)
        .foregroundStyle(.secondary)
      if let done {
        Button(MiniAppText.string("guide.done"), action: done)
          .buttonStyle(InkButtonStyle(kind: .filled, form: .block))
          .padding(.top, 8)
      }
    }
  }

  private static var steps: [String] {
    [
      MiniAppText.string("guide.step.hold"), MiniAppText.string("guide.step.edit"),
      MiniAppText.string("guide.step.add"),
    ]
  }
}
