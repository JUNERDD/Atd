import AICore
import AIWidgetModel
import AIWidgetRender
import AppKit

/// What people do with a pin: open its app, move and resize it, choose its widget and size,
/// remove it, and drag a new one out of the panel.
extension DesktopPins {
  func makeModel(_ appId: String, look: DesktopPinLook) -> DesktopPinModel {
    let model = DesktopPinModel(look: look)
    model.onOpen = { [weak self] route in self?.onOpen?(appId, route) }
    model.onLink = { [weak self] url in self?.openLink(url, of: appId) }
    model.onRemove = { [weak self] in self?.unpin(appId: appId) }
    model.onShowMenu = { [weak self] in self?.windows[appId]?.showMenuForAccessibility() }
    models[appId] = model
    return model
  }

  func makeWindow(_ appId: String, model: DesktopPinModel, frame: ScreenRect) -> DesktopPinWindow {
    let window = DesktopPinWindow(model: model, frame: NSRect(frame))
    window.onMoved = { [weak self] frame in self?.moved(appId, to: frame) }
    window.onResize = { [weak self] corner, dx, dy in
      self?.resize(appId, from: corner, by: dx, dy)
    }
    window.onResized = { [weak self] in self?.resized(appId) }
    window.makeMenu = { [weak self] in self?.menu(for: appId) }
    window.orderFrontRegardless()
    return window
  }

  /// VoiceOver's name and actions, in the current language.
  func label(_ model: DesktopPinModel, record: DesktopPinRecord) {
    let strings = ShellStrings.shared
    let name = model.look.name
    let title = shownFace(record).widgetId.flatMap { id in
      declarations(record.appId)?.widgets.first { $0.id == id }?.title
    }
    model.label = title.map { strings.catalog(.pinAccessibilityLabel, name, $0) } ?? name
    model.openTitle = strings.text(.pinMenuOpen, name)
    model.removeTitle = strings.text(.pinMenuRemove)
  }

  /// A `link` node's URL: only a ``WidgetLink`` of this pin's app opens anything.
  private func openLink(_ url: URL, of appId: String) {
    guard let scheme = WidgetLink.mainBundleScheme,
      case .app(let target, let route)? = WidgetLink.parse(url, scheme: scheme), target == appId
    else { return Self.log.error("A pin refused a link that is not its app's.") }
    onOpen?(appId, route)
  }

  // MARK: Resize

  /// A resize from `corner` travelled (`dx`, `dy`, y up) since the press: the pin follows at any
  /// size its layouts handle well, the opposite corner of its place held, with a magnet to the
  /// declared sizes (``DesktopPinGeometry/resize(_:from:by:_:ranges:magnets:in:)``), until the
  /// resize ends. Within one family the window alone changes and the layout reflows; crossing
  /// into another family redraws the pin and reports that family, so its render can start.
  func resize(_ appId: String, from corner: DesktopPinGeometry.Corner, by dx: Double, _ dy: Double)
  {
    guard let record = record(appId) else { return }
    let face = fallbackFace(record)
    let frame = DesktopPinGeometry.resize(
      frame(for: record), from: corner, by: dx, dy, ranges: ranges(face, appId),
      magnets: families(of: face, appId).map { Self.size(of: $0) },
      in: DesktopPinScreens.placement(display: record.display).workArea)
    let resize = Resize(
      face: face.with(family: family(for: frame.size, face, appId)), frame: frame)
    let before = resizes[appId]
    guard before != resize else { return }
    resizes[appId] = resize
    if before?.face == resize.face {
      windows[appId]?.place(frame)
      windows[appId]?.resizeDirections = resizeDirections(record)
    } else if refresh(appId) {
      onChange?()
    }
  }

  /// The resize ended: the pin keeps the size and place it showed, saved and reported. A face the
  /// widget no longer declares gives way to the pin's own.
  func resized(_ appId: String) {
    guard let resize = resizes.removeValue(forKey: appId), let record = record(appId) else {
      return
    }
    if declares(appId, resize.face),
      resize.frame != frame(for: record) || resize.face != shownFace(record)
    {
      keep(appId, face: resize.face, frame: resize.frame)
    } else if refresh(appId) {
      onChange?()
    }
  }

  // MARK: Menu

  /// Open “Name”; the sizes the pin can take, when two or more; Widget ▸ (the declared widgets and
  /// App Icon) when the app declares one; then Remove from Desktop. A separator parts each group
  /// from the next.
  func menu(for appId: String) -> NSMenu? {
    guard let record = record(appId), let model = models[appId] else { return nil }
    let strings = ShellStrings.shared
    let route = model.look.route
    let open = ActionMenuItem(strings.text(.pinMenuOpen, model.look.name)) { [weak self] in
      self?.onOpen?(appId, route)
    }
    let remove = ActionMenuItem(strings.text(.pinMenuRemove)) { [weak self] in
      self?.unpin(appId: appId)
    }
    let groups: [[NSMenuItem]] = [[open], sizeChoices(record), widgetChoices(record), [remove]]
    let menu = NSMenu()
    menu.autoenablesItems = false
    for group in groups where !group.isEmpty {
      if !menu.items.isEmpty { menu.addItem(.separator()) }
      for item in group { menu.addItem(item) }
    }
    return menu
  }

  /// The sizes the pin can take as presets, smallest first, each setting the pin to exactly that
  /// family's size and checked only while the pin is exactly that size; none below two.
  private func sizeChoices(_ record: DesktopPinRecord) -> [NSMenuItem] {
    let families = families(record)
    guard families.count > 1 else { return [] }
    let shown = shownFace(record)
    let size = frame(for: record).size
    return families.map { family in
      choice(
        ShellStrings.shared.text(Self.sizeKey(family)), on: size == Self.size(of: family),
        record.appId, shown.with(family: family), keepingSize: false)
    }
  }

  /// Widget ▸: the declared widgets, and App Icon, each keeping the pin's size as near as it
  /// allows; none for an app that declares no widget.
  private func widgetChoices(_ record: DesktopPinRecord) -> [NSMenuItem] {
    let widgets = declarations(record.appId)?.widgets ?? []
    guard !widgets.isEmpty else { return [] }
    let strings = ShellStrings.shared
    let shown = shownFace(record)
    let icon = choice(
      strings.text(.pinMenuAppIcon), on: shown.widgetId == nil, record.appId,
      Self.tile(near: shown.family), keepingSize: true)
    let choices =
      widgets.map { widget in
        choice(
          widget.title, on: shown.widgetId == widget.id, record.appId,
          .widget(id: widget.id, family: Self.nearest(shown.family, in: widget.families)),
          keepingSize: true)
      } + [icon]
    return [submenu(strings.text(.pinMenuWidget), choices)]
  }

  private static func sizeKey(_ family: WidgetFamily) -> ShellStringKey {
    switch family {
    case .systemSmall: .pinSizeSmall
    case .systemMedium: .pinSizeMedium
    case .systemLarge: .pinSizeLarge
    }
  }

  /// A radio choice of what the pin shows.
  private func choice(
    _ title: String, on: Bool, _ appId: String, _ face: DesktopPinFace, keepingSize: Bool
  ) -> NSMenuItem {
    let item = ActionMenuItem(title) { [weak self] in
      self?.change(appId, to: face, keepingSize: keepingSize)
    }
    item.state = on ? .on : .off
    return item
  }

  private func submenu(_ title: String, _ items: [NSMenuItem]) -> NSMenuItem {
    let submenu = NSMenu(title: title)
    submenu.autoenablesItems = false
    for item in items { submenu.addItem(item) }
    let item = NSMenuItem(title: title, action: nil, keyEquivalent: "")
    item.submenu = submenu
    return item
  }

  // MARK: Drag out

  /// `userApp.pinDrag`, whose press the caller checked: drags the pin the app has, or would get,
  /// out of the page. Ignored outside an app, while another drag runs, and for a new pin past
  /// the limit.
  func startDrag(appId: String, press: NSEvent, from webView: ShellWebView) {
    guard store != nil, UserAppOrigin.isValidAppId(appId), !drag.isActive,
      record(appId) != nil || records.count < DesktopPinStore.limit
    else { return Self.log.notice("A pin drag was refused.") }
    let record =
      record(appId)
      ?? DesktopPinRecord(
        appId: appId, face: defaultFace(appId), display: nil, offset: .init(x: 0, y: 0))
    let look = look(for: record).look
    // The pin at its current size: the card fills whatever frame it is given.
    let pinned = pinSize(record)
    let size = CGSize(width: pinned.width, height: pinned.height)
    guard
      let image = WidgetPreview.image(
        of: DesktopPinCard(look: look).frame(width: size.width, height: size.height))
    else { return }
    _ = drag.start(
      appId: appId, image: NSImage(cgImage: image, size: size), press: press, from: webView)
  }
}
