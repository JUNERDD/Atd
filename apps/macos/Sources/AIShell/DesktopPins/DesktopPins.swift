import AICore
import AIRelay
import AIWidgetModel
import AppKit
import OSLog

/// The apps pinned to the desktop (decision D5). macOS has no public API that adds a WidgetKit
/// widget, so a pin is the shell's own window (``DesktopPinWindow``): one per app, showing one of
/// the app's declared widgets drawn from the same synced snapshot files the extension reads, or
/// the app's tile, small (icon and name) or medium (icon, name and description).
///
/// - **Records** live in ``DesktopPinStore``, per service data directory. They are restored at
///   launch from the widget files the last pull wrote, before the service connects, so pins come
///   back with the desktop; every pull then applies the service's catalog (``apply(_:)``).
/// - **Fallbacks**, applied while showing and never written back: a widget the app no longer
///   declares gives way to its first declared widget in the nearest family; an app whose catalog
///   entry is gone keeps its widget for a ``grace`` period, since the catalog drops an app until
///   its new build reports its widgets, and shows its tile after that. A deleted app's pin goes
///   (`userApp.clearData` with `forget`, or a 404 runtime for an app no list names any more).
/// - **Service**: widget pins are reported as `AtdDesktopPin` instances (``instances``), which
///   the publisher renders like placed widgets; the pages follow ``state`` (`userApp.pins`).
final class DesktopPins {
  /// How long a pinned widget outlasts its app's absence from the catalog.
  static let grace: TimeInterval = 30
  static let log = Logger(subsystem: "com.junerdd.ai", category: "desktop-pins")

  /// What a resize in progress shows: its frame, with the dragged corner's opposite held inside
  /// the work area, and the face in the family that size shows.
  struct Resize: Equatable {
    let face: DesktopPinFace
    let frame: ScreenRect
  }

  let files: WidgetFiles?
  let services: ShellServices
  let store: DesktopPinStore?
  let icons = PinIconRasterizer()
  let drag = DesktopPinDrag()

  /// Oldest first; at most ``DesktopPinStore/limit``.
  private(set) var records: [DesktopPinRecord] = []
  var windows: [String: DesktopPinWindow] = [:]
  var models: [String: DesktopPinModel] = [:]
  /// The catalog and launcher of the last pull, or of the files at launch.
  private(set) var catalog: [String: WidgetCatalogApp] = [:]
  private(set) var launcher: [String: WidgetLauncherApp] = [:]
  /// Each app's last listed catalog entry, which outlives a build that has not reported yet.
  private(set) var known: [String: WidgetCatalogApp] = [:]
  /// Pinned apps no list names, from their runtime: the name, and the icon's bytes.
  var unlisted: [String: (name: String, icon: Data?)] = [:]
  /// When each pinned app was last found missing from the catalog.
  private(set) var missingSince: [String: Date] = [:]
  /// The last snapshot each shown widget read, kept when its file goes away (the writer removes
  /// the snapshots of apps the catalog stops listing).
  var snapshots: [String: WidgetSnapshot] = [:]
  /// What each pin showed when it was last drawn, to tell when the reported list changes.
  var shown: [String: DesktopPinFace] = [:]
  /// Each resize in progress: the size and the frame it shows, which nothing reports or saves
  /// until it ends.
  var resizes: [String: Resize] = [:]
  var timers: [String: Task<Void, Never>] = [:]
  private var observers: [NSObjectProtocol] = []

  /// The list, or what a pin shows, changed: the pages and the service's instances follow.
  var onChange: (() -> Void)?
  /// Opens an app at a route; nil brings it forward as it is.
  var onOpen: ((_ appId: String, _ route: String?) -> Void)?

  init(services: ShellServices, files: WidgetFiles?) {
    self.services = services
    self.files = files
    store = DesktopPinStore(files: files, dataDirectory: services.dataDirectory)
    drag.onDrop = { [weak self] appId, point in self?.dropped(appId, at: point) }
  }

  /// Shows the saved pins from the widget files as they are.
  func restore() {
    records = store?.load() ?? []
    take(
      catalog: (try? files?.readCatalog().get())?.apps ?? [],
      launcher: (try? files?.readLauncher().get())?.apps ?? [])
    observe()
    refreshAll()
  }

  /// After a pull wrote `sync` to the widget files.
  func apply(_ sync: WidgetSync) {
    take(catalog: sync.catalog, launcher: sync.launcher)
    refreshAll()
    Task { await checkUnlisted() }
  }

  private func take(catalog apps: [WidgetCatalogApp], launcher listed: [WidgetLauncherApp]) {
    catalog = Dictionary(apps.map { ($0.appId, $0) }, uniquingKeysWith: { first, _ in first })
    launcher = Dictionary(listed.map { ($0.appId, $0) }, uniquingKeysWith: { first, _ in first })
    for app in apps { known[app.appId] = app }
    for record in records { noteListing(record.appId) }
  }

  private func noteListing(_ appId: String) {
    if catalog[appId] != nil {
      missingSince[appId] = nil
    } else if missingSince[appId] == nil {
      missingSince[appId] = .now
    }
  }

  func record(_ appId: String) -> DesktopPinRecord? { records.first { $0.appId == appId } }

  // MARK: Changes

  /// `userApp.pin`: pins the app in the first free place on the display holding `frame`, or
  /// shows `face` on its pin. Rejects an unknown app, an undeclared widget or one pin too many.
  func pin(appId: String, face requested: DesktopPinFace?, near frame: ScreenRect?)
    async throws(BridgeError)
  {
    guard store != nil else { throw BridgeError(ShellStrings.shared.text(.pinFailed)) }
    if let requested, !declares(appId, requested) {
      throw BridgeError(ShellStrings.shared.text(.pinFailed))
    }
    if record(appId) != nil {
      if let requested { change(appId, to: requested, keepingSize: false) }
      return
    }
    try checkLimit()
    try await requireApp(appId)
    guard record(appId) == nil else { return }
    try checkLimit()
    let face = requested ?? defaultFace(appId)
    let placement =
      frame.map(DesktopPinScreens.placement(containing:))
      ?? DesktopPinScreens.placement(display: nil)
    let slot = DesktopPinGeometry.freeSlot(
      size: Self.size(of: face), in: placement.workArea,
      occupied: windows.values.map { ScreenRect($0.frame) })
    add(appId, face: face, frame: slot, placement: placement)
  }

  /// `userApp.unpin`, and the menu's Remove from Desktop.
  func unpin(appId: String) {
    guard let index = records.firstIndex(where: { $0.appId == appId }) else { return }
    records.remove(at: index)
    windows.removeValue(forKey: appId)?.close()
    models[appId] = nil
    shown[appId] = nil
    resizes[appId] = nil
    timers.removeValue(forKey: appId)?.cancel()
    save()
    onChange?()
  }

  /// The app was deleted: its pin and everything kept about it go.
  func forget(appId: String) {
    unpin(appId: appId)
    known[appId] = nil
    unlisted[appId] = nil
    missingSince[appId] = nil
    icons.forget(appId: appId)
  }

  /// Shows `face` on the app's pin, its top-left corner kept inside the work area. A widget or
  /// App Icon choice keeps the pin's size (`keepingSize`), as near as the new face allows; a size
  /// preset, or a widget a page asks for, gives the pin exactly its family's size.
  func change(_ appId: String, to face: DesktopPinFace, keepingSize: Bool) {
    guard let index = records.firstIndex(where: { $0.appId == appId }),
      records[index].face != face || (!keepingSize && records[index].size != nil)
    else { return }
    records[index].face = face
    if !keepingSize { records[index].size = nil }
    let placement = DesktopPinScreens.placement(display: records[index].display)
    // A pin shown on the main display while its own is gone keeps its own offset.
    if placement.display == records[index].display {
      records[index].offset = DesktopPinGeometry.offset(
        of: frame(for: records[index]), in: placement.workArea)
    }
    save()
    refresh(appId)
    onChange?()
  }

  /// A resize ended at `frame`, already inside the work area, showing `face`: the pin keeps that
  /// size, and the frame's top-left corner, which a resize from a left or top corner moved. So a
  /// relaunch shows exactly the pin that was left.
  func keep(_ appId: String, face: DesktopPinFace, frame: ScreenRect) {
    guard let index = records.firstIndex(where: { $0.appId == appId }) else { return }
    let placement = DesktopPinScreens.placement(display: records[index].display)
    records[index].face = face
    records[index].size = frame.size
    records[index].offset = DesktopPinGeometry.offset(of: frame, in: placement.workArea)
    save()
    refresh(appId)
    onChange?()
  }

  /// A move ended at `frame`: the pin stays inside the work area of the display holding most of
  /// it, which becomes its display.
  func moved(_ appId: String, to frame: ScreenRect) {
    guard let index = records.firstIndex(where: { $0.appId == appId }) else { return }
    let placement = DesktopPinScreens.placement(containing: frame)
    let kept = PanelGeometry.constrain(frame, to: placement.workArea)
    records[index].display = placement.display
    records[index].offset = DesktopPinGeometry.offset(of: kept, in: placement.workArea)
    windows[appId]?.place(kept)
    save()
  }

  /// A pin drag dropped on the desktop: the pin goes there, centered on the point.
  private func dropped(_ appId: String, at point: NSPoint) {
    let placement = DesktopPinScreens.placement(nearestTo: point.x, point.y)
    if let record = record(appId) {
      let size = pinSize(record)
      return moved(
        appId,
        to: DesktopPinGeometry.centered(x: point.x, y: point.y, size: size, in: placement.workArea))
    }
    Task {
      do throws(BridgeError) {
        try checkLimit()
        try await requireApp(appId)
        guard record(appId) == nil else { return }
        try checkLimit()
        let face = defaultFace(appId)
        let frame = DesktopPinGeometry.centered(
          x: point.x, y: point.y, size: Self.size(of: face), in: placement.workArea)
        add(appId, face: face, frame: frame, placement: placement)
      } catch {
        Self.log.error("A dropped pin was refused: \(error.message, privacy: .public)")
      }
    }
  }

  private func add(
    _ appId: String, face: DesktopPinFace, frame: ScreenRect,
    placement: DesktopPinScreens.Placement
  ) {
    records.append(
      DesktopPinRecord(
        appId: appId, face: face, display: placement.display,
        offset: DesktopPinGeometry.offset(of: frame, in: placement.workArea)))
    noteListing(appId)
    save()
    refresh(appId)
    onChange?()
  }

  private func checkLimit() throws(BridgeError) {
    guard records.count < DesktopPinStore.limit else {
      throw BridgeError(ShellStrings.shared.text(.pinLimit, count: DesktopPinStore.limit))
    }
  }

  private func save() { store?.save(records) }

  // MARK: Displays, clock and language

  private func observe() {
    guard observers.isEmpty else { return }
    let center = NotificationCenter.default
    let names = [ShellStrings.didChange, .NSSystemClockDidChange]
    observers =
      names.map { name in
        center.addObserver(forName: name, object: nil, queue: .main) { [weak self] _ in
          MainActor.assumeIsolated { self?.refreshAll() }
        }
      } + [
        center.addObserver(
          forName: NSApplication.didChangeScreenParametersNotification, object: nil, queue: .main
        ) { [weak self] _ in MainActor.assumeIsolated { self?.layOut() } },
        NSWorkspace.shared.notificationCenter.addObserver(
          forName: NSWorkspace.didWakeNotification, object: nil, queue: .main
        ) { [weak self] _ in MainActor.assumeIsolated { self?.refreshAll() } },
      ]
  }

  /// Displays changed: every pin is placed again from its record.
  private func layOut() {
    for record in records { windows[record.appId]?.place(drawnFrame(record)) }
  }

  // MARK: Reports

  /// The pages' `userApp.pins`: what each pin shows, oldest first. A tile has no widget id, and
  /// no family when small, as before tiles came in two sizes.
  var state: UserAppPinsEvent {
    UserAppPinsEvent(
      pins: records.map { record in
        let face = drawnFace(record)
        let family = face == .tile(family: .systemSmall) ? nil : face.family
        return .init(
          appId: record.appId, widgetId: face.widgetId,
          family: family.map(UserAppPinsEvent.Pin.Family.init))
      })
  }

  /// The widget pins as instances the service renders: each in the family its size shows, so a
  /// resize across a breakpoint asks for the new family's render at once.
  var instances: [WidgetInstance] {
    records.compactMap { record in
      guard case .widget(let id, let family) = drawnFace(record) else { return nil }
      return WidgetInstance(
        kind: WidgetKinds.desktopPin, family: family, appId: record.appId, widgetId: id)
    }
  }

  /// The service no longer has the app.
  static func isGone(_ error: any Error) -> Bool {
    if case .http(let status, _, _) = error as? ShellClientError { return status == 404 }
    return false
  }
}

extension UserAppPinsEvent.Pin.Family {
  init(_ family: WidgetFamily) {
    switch family {
    case .systemSmall: self = .systemSmall
    case .systemMedium: self = .systemMedium
    case .systemLarge: self = .systemLarge
    }
  }
}
