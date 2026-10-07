import AIWidgetModel
import AIWidgetRender
import AppKit
import SwiftUI

/// What a desktop pin draws, as ``DesktopPins`` resolved it.
struct DesktopPinLook {
  enum Body {
    /// The due entry of the widget's latest render.
    case widget(WidgetPlannedEntry)
    /// No render of the widget has arrived yet: the gallery's stand-in, with the widget's title.
    case standIn(title: String)
    /// The widget's render cannot be read; the message is localized.
    case unreadable(message: String)
    /// The app's tile: its icon once drawn (``PinIconRasterizer``), else the fallback tile.
    case tile(icon: CGImage?)
  }

  let appId: String
  /// The family whose tree, or tile layout, the pin's size shows; a tile is small or medium.
  var family: WidgetFamily
  var name: String
  /// The app's description, which the medium tile shows beside its icon.
  var description: String?
  var accent: WidgetAccent?
  var body: Body
  var context: WidgetRenderContext

  /// What a click on the pin opens: a widget's entry route (`/` without one); the other states
  /// bring the app forward as it is, like a launcher tile.
  var route: String? {
    if case .widget(let entry) = body { return entry.route ?? "/" }
    return nil
  }
}

/// The pin as drawn: the widget card (``WidgetCardView``) holding the widget's tree, the
/// stand-in, a message or the app's tile, laid out at whatever size it is given, the pin
/// window's, never scaled. The live pin and the image dragged out of the panel both draw this,
/// so what is dragged is what lands.
struct DesktopPinCard: View {
  let look: DesktopPinLook

  var body: some View {
    WidgetCardView {
      content.widgetAccent(look.accent)
    }
  }

  @ViewBuilder
  private var content: some View {
    switch look.body {
    case .widget(let entry):
      WidgetTreeView(entry.view, context: look.context)
    case .standIn(let title):
      WidgetTreeView(
        WidgetStandIn.branded(appName: look.name, title: title, family: look.family),
        context: .inert)
    case .unreadable(let message):
      WidgetMessageView(symbol: "exclamationmark.triangle", title: nil, message: message)
    case .tile(let icon):
      WidgetLauncherView(
        tiles: [
          WidgetLauncherTile(
            id: look.appId, name: look.name, description: look.description, accent: look.accent,
            icon: icon.map { .image($0) } ?? .symbol("app.fill"), url: nil)
        ], layout: look.family == .systemMedium ? .pinTileMedium : .pinTile)
    }
  }
}

/// One pin's live state: what it draws, how VoiceOver names it, and what its actions do.
@Observable
final class DesktopPinModel {
  var look: DesktopPinLook
  /// The app's name, with the widget's title when the pin shows a widget.
  var label = ""
  var openTitle = ""
  var removeTitle = ""
  @ObservationIgnored var onOpen: (_ route: String?) -> Void = { _ in }
  /// A `link` node's URL, which only ``WidgetLink`` may turn into an app and route.
  @ObservationIgnored var onLink: (_ url: URL) -> Void = { _ in }
  @ObservationIgnored var onRemove: () -> Void = {}
  @ObservationIgnored var onShowMenu: () -> Void = {}

  init(look: DesktopPinLook) {
    self.look = look
  }
}

/// The live pin: a click opens the app like the WidgetKit widget (a `link` node its route, the
/// rest of the card the entry's), never through LaunchServices. VoiceOver reads the widget's own
/// text inside one element named for the app, with Open, Remove from Desktop and the menu as
/// actions; the pin takes no keyboard focus, like a system widget.
struct DesktopPinView: View {
  let model: DesktopPinModel

  var body: some View {
    DesktopPinCard(look: model.look)
      .contentShape(RoundedRectangle(cornerRadius: WidgetCard.cornerRadius, style: .continuous))
      .onTapGesture { model.onOpen(model.look.route) }
      .environment(
        \.openURL,
        OpenURLAction { url in
          model.onLink(url)
          return .handled
        }
      )
      .accessibilityElement(children: .contain)
      .accessibilityLabel(Text(verbatim: model.label))
      .accessibilityAction(named: Text(verbatim: model.openTitle)) {
        model.onOpen(model.look.route)
      }
      .accessibilityAction(named: Text(verbatim: model.removeTitle)) { model.onRemove() }
      .accessibilityAction(.showMenu) { model.onShowMenu() }
  }
}

/// Hosts a pin's view and takes the first click, since the pin never becomes key.
final class DesktopPinHostingView: NSHostingView<DesktopPinView> {
  override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
}
