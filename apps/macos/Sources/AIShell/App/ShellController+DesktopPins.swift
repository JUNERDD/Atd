import AICore
import AIWidgetModel
import AppKit
import OSLog

/// The bridge's side of desktop pins (``DesktopPins``): `userApp.pin`, `userApp.unpin`, the
/// `userApp.pinDrag` post, and the `userApp.pins` state every page follows.
extension ShellController {
  private static let pinLog = Logger(subsystem: "com.junerdd.ai", category: "desktop-pins")
  /// A press older than this, in seconds, no longer starts a pin drag.
  private static let pressLifetime: TimeInterval = 2

  var pins: DesktopPins { widgets.pins }

  /// Sends pin changes to the pages and the service, opens apps from pins, then shows the saved
  /// pins. The service hears of a change only while connected; connecting reports anyway.
  func startDesktopPins() {
    pins.onChange = { [weak self] in
      guard let self else { return }
      broadcast(.userAppPins(pins.state))
      if control.state == .connected { Task { await self.widgets.report() } }
    }
    pins.onOpen = { [weak self] appId, route in
      self?.openUserAppWhenConnected(appId, route: route)
    }
    pins.restore()
  }

  /// The latest pins for a settings window opened after they last changed.
  func replayPins(to host: WebViewHost) {
    host.setState(.userAppPins(pins.state))
  }

  /// `userApp.pin`: a new pin goes on the display of the window that asked.
  func pinUserApp(_ params: UserAppPinParams, from host: WebViewHost) async throws(BridgeError) {
    let face = params.widget.map {
      DesktopPinFace.widget(id: $0.widgetId, family: WidgetFamily($0.family))
    }
    let frame = host.container.window.map { ScreenRect($0.frame) }
    try await pins.pin(appId: params.appId, face: face, near: frame)
  }

  /// `userApp.pinDrag`, taken only from the panel and settings pages, while the left button is
  /// down after a press in that page under ``pressLifetime`` old, and not during a capture: a
  /// page cannot fake the physical press.
  func startPinDrag(_ appId: String, from host: WebViewHost) {
    let webView = host.webView
    guard host.role != .onboarding, !isCapturingScreenshot,
      NSEvent.pressedMouseButtons & 1 == 1,
      let press = webView.lastMouseDown, press.window === webView.window,
      ProcessInfo.processInfo.systemUptime - press.timestamp < Self.pressLifetime
    else { return Self.pinLog.notice("Refused a pin drag without a live press.") }
    pins.startDrag(appId: appId, press: press, from: webView)
  }
}

extension WidgetFamily {
  fileprivate init(_ family: UserAppPinParams.Widget.Family) {
    switch family {
    case .systemSmall: self = .systemSmall
    case .systemMedium: self = .systemMedium
    case .systemLarge: self = .systemLarge
    }
  }
}
