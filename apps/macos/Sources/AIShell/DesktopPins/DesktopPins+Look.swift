import AICore
import AIRelay
import AIWidgetModel
import AIWidgetRender
import AppKit

/// What each pin shows, and keeping it current: the fallbacks, the snapshot's due entry, a timer
/// for its next one, and the tile's icon.
extension DesktopPins {
  static func size(of face: DesktopPinFace) -> WindowSize { size(of: face.family) }

  static func size(of family: WidgetFamily) -> WindowSize {
    let size = WidgetCard.size(of: family)
    return WindowSize(width: size.width, height: size.height)
  }

  /// The tile in its size nearest `family`: a widget pin that becomes its app's tile keeps as
  /// close to its footprint as a tile can.
  static func tile(near family: WidgetFamily) -> DesktopPinFace {
    .tile(family: nearest(family, in: DesktopPinFace.tileFamilies))
  }

  /// The family of `families` closest in size to `family`, the smaller one on a tie.
  static func nearest(_ family: WidgetFamily, in families: [WidgetFamily]) -> WidgetFamily {
    let target = rank(family)
    return families.min {
      (abs(rank($0) - target), rank($0)) < (abs(rank($1) - target), rank($1))
    } ?? family
  }

  private static func rank(_ family: WidgetFamily) -> Int {
    switch family {
    case .systemSmall: 0
    case .systemMedium: 1
    case .systemLarge: 2
    }
  }

  /// The app's catalog entry, or the last one listed while a new build has not reported.
  func declarations(_ appId: String) -> WidgetCatalogApp? { catalog[appId] ?? known[appId] }

  private func inGrace(_ appId: String) -> Bool {
    missingSince[appId].map { Date.now.timeIntervalSince($0) < Self.grace } ?? false
  }

  /// What the record's pin shows now: its widget after the fallbacks, or its tile, in the family
  /// its size shows (``family(for:_:_:)``); a pin without a size of its own keeps its family.
  func shownFace(_ record: DesktopPinRecord) -> DesktopPinFace {
    let face = fallbackFace(record)
    guard record.size != nil else { return face }
    return face.with(family: family(for: pinSize(record), face, record.appId))
  }

  /// The record's face after the fallbacks, in the family it had or the nearest one its widget
  /// still declares.
  func fallbackFace(_ record: DesktopPinRecord) -> DesktopPinFace {
    guard case .widget(let id, let family) = record.face else { return record.face }
    if let app = catalog[record.appId] { return Self.fallback(id: id, family: family, in: app) }
    guard inGrace(record.appId) else { return Self.tile(near: family) }
    guard let app = known[record.appId] else { return record.face }
    return Self.fallback(id: id, family: family, in: app)
  }

  /// The widget in the nearest family it declares; its app's first widget once it declares the
  /// widget no longer; the tile once the app declares none.
  private static func fallback(id: String, family: WidgetFamily, in app: WidgetCatalogApp)
    -> DesktopPinFace
  {
    guard let widget = app.widgets.first(where: { $0.id == id }) ?? app.widgets.first else {
      return tile(near: family)
    }
    return .widget(id: widget.id, family: nearest(family, in: widget.families))
  }

  /// A new pin's face: the app's first widget in its smallest family, else the small tile.
  func defaultFace(_ appId: String) -> DesktopPinFace {
    guard let widget = declarations(appId)?.widgets.first,
      let family = widget.families.min(by: { Self.rank($0) < Self.rank($1) })
    else { return .tile(family: .systemSmall) }
    return .widget(id: widget.id, family: family)
  }

  /// Whether the app declares the face's widget in its family; any app has its tile in either
  /// tile size.
  func declares(_ appId: String, _ face: DesktopPinFace) -> Bool {
    guard case .widget(let id, let family) = face else {
      return DesktopPinFace.tileFamilies.contains(face.family)
    }
    return declarations(appId)?.widgets.contains { $0.id == id && $0.families.contains(family) }
      == true
  }

  /// What the record's pin draws and reports: a resize's face while one runs, else
  /// ``shownFace(_:)``.
  func drawnFace(_ record: DesktopPinRecord) -> DesktopPinFace {
    resizes[record.appId]?.face ?? shownFace(record)
  }

  /// Where the record's pin is drawn: a resize's frame while it runs, else its place.
  func drawnFrame(_ record: DesktopPinRecord) -> ScreenRect {
    resizes[record.appId]?.frame ?? frame(for: record)
  }

  // MARK: Drawing

  /// What the record's pin draws, and when that next changes by itself: its widget's next
  /// timeline entry, or the end of the grace period.
  func look(for record: DesktopPinRecord) -> (look: DesktopPinLook, next: Date?) {
    let appId = record.appId
    let name =
      catalog[appId]?.name ?? launcher[appId]?.name ?? known[appId]?.name
      ?? unlisted[appId]?.name ?? ""
    let accent = catalog[appId]?.accent ?? launcher[appId]?.accent ?? known[appId]?.accent
    let graceEnd = missingSince[appId].map { $0.addingTimeInterval(Self.grace) }
      .flatMap { $0 > .now ? $0 : nil }
    let drawn = drawnFace(record)
    guard case .widget(let id, let family) = drawn else {
      let tile = DesktopPinLook(
        appId: appId, family: drawn.family, name: name, description: launcherDescription(appId),
        accent: accent, body: .tile(icon: icons.cached(appId: appId)), context: .inert)
      return (tile, graceEnd)
    }
    let title = declarations(appId)?.widgets.first { $0.id == id }?.title ?? ""
    let (body, next) = widgetBody(appId, id: id, family: family, title: title)
    let look = DesktopPinLook(
      appId: appId, family: family, name: name, description: nil, accent: accent, body: body,
      context: context(appId))
    return (look, [graceEnd, next].compactMap { $0 }.min())
  }

  /// The launcher's description of the app, its white space collapsed to single spaces, for a
  /// medium tile; nil without one. An app beyond the launcher's list has none here.
  func launcherDescription(_ appId: String) -> String? {
    let words = launcher[appId]?.description?.split(whereSeparator: \.isWhitespace) ?? []
    return words.isEmpty ? nil : words.joined(separator: " ")
  }

  static func snapshotKey(_ appId: String, _ id: String, _ family: WidgetFamily) -> String {
    "\(appId)/\(id)/\(family.rawValue)"
  }

  /// The due entry of the widget's snapshot, the one kept from before when its file is gone, or
  /// the stand-in until a render arrives; and the date of the next entry.
  private func widgetBody(_ appId: String, id: String, family: WidgetFamily, title: String)
    -> (DesktopPinLook.Body, Date?)
  {
    let key = Self.snapshotKey(appId, id, family)
    switch files?.readSnapshot(appId: appId, widgetId: id, family: family) {
    case .success(let snapshot)?:
      snapshots[key] = snapshot
    case .failure(.invalid)? where snapshots[key] == nil:
      return (.unreadable(message: ShellStrings.shared.text(.pinUnreadable)), nil)
    default:
      break
    }
    let now = Date.now
    guard let snapshot = snapshots[key],
      let entry = WidgetTimelinePlan.entries(of: snapshot.timeline, now: now).first
    else { return (.standIn(title: title), nil) }
    let later = WidgetTimelinePlan.entries(of: snapshot.timeline, now: now).first { $0.date > now }
    return (.widget(entry), later?.date)
  }

  /// Images from the widget files; a link opens the app at its route through ``WidgetLink``.
  private func context(_ appId: String) -> WidgetRenderContext {
    guard let files else { return .inert }
    let scheme = WidgetLink.mainBundleScheme
    return WidgetPreview.context(files: files, appId: appId) { route in
      scheme.flatMap { WidgetLink.url(scheme: $0, appId: appId, route: route) }
    }
  }

  /// Redraws one pin from its record, opening its window the first time. True when what it
  /// draws changed family or widget, which the reports carry, a resize in progress included.
  @discardableResult
  func refresh(_ appId: String) -> Bool {
    guard let record = record(appId) else { return false }
    let (look, next) = look(for: record)
    let model = models[appId] ?? makeModel(appId, look: look)
    model.look = look
    label(model, record: record)
    let frame = drawnFrame(record)
    if let window = windows[appId] {
      window.place(frame)
    } else {
      windows[appId] = makeWindow(appId, model: model, frame: frame)
    }
    windows[appId]?.title = look.name
    windows[appId]?.resizeDirections = resizeDirections(record)
    schedule(appId, at: next)
    drawIcon(appId, look: look)
    let face = drawnFace(record)
    defer { shown[appId] = face }
    return shown[appId] != face
  }

  /// Redraws every pin, then reports.
  func refreshAll() {
    let kept = Set(
      records.compactMap { record -> String? in
        guard case .widget(let id, let family) = drawnFace(record) else { return nil }
        return Self.snapshotKey(record.appId, id, family)
      })
    snapshots = snapshots.filter { kept.contains($0.key) }
    for record in records { refresh(record.appId) }
    onChange?()
  }

  private func schedule(_ appId: String, at date: Date?) {
    timers.removeValue(forKey: appId)?.cancel()
    guard let date else { return }
    let delay = max(0, date.timeIntervalSinceNow) + 0.05
    timers[appId] = Task { [weak self] in
      try? await Task.sleep(for: .seconds(delay))
      guard !Task.isCancelled, let self else { return }
      if refresh(appId) { onChange?() }
    }
  }

  /// Draws a tile's icon out of process when its bytes changed: the launcher's copy, or for an
  /// app beyond the launcher the one its runtime names. Without one the tile keeps its fallback.
  private func drawIcon(_ appId: String, look: DesktopPinLook) {
    guard case .tile = look.body else { return }
    guard let svg = files?.readIcon(appId: appId) ?? unlisted[appId]?.icon else {
      icons.forget(appId: appId)
      models[appId]?.look.body = .tile(icon: nil)
      return
    }
    guard icons.needsDrawing(appId: appId, svg: svg) else { return }
    Task { [weak self] in
      guard let self else { return }
      let image = await icons.image(appId: appId, svg: svg)
      guard let model = models[appId], case .tile = model.look.body else { return }
      model.look.body = .tile(icon: image)
    }
  }

  // MARK: Apps no list names

  /// After a pull: the runtime of each pinned app neither the catalog nor the launcher lists,
  /// and of a tile pin's app beyond the launcher, for its name and icon. A 404 means the app was
  /// deleted, perhaps while Atd was not running, and removes its pin.
  func checkUnlisted() async {
    let appIds = records.map(\.appId).filter { appId in
      launcher[appId] == nil
        && (catalog[appId] == nil || record(appId).map { shownFace($0).widgetId == nil } == true)
    }
    guard !appIds.isEmpty, let client = try? await services.client() else { return }
    for appId in appIds where record(appId) != nil {
      do {
        let runtime = try await client.appRuntime(appId: appId)
        unlisted[appId] = (runtime.name, try? WidgetLauncherWriter.icon(of: runtime))
        refresh(appId)
      } catch {
        guard Self.isGone(error) else { continue }
        Self.log.notice("Removed the desktop pin of a deleted app.")
        forget(appId: appId)
      }
    }
  }

  /// Returns once the app is known to exist: listed by the last pull, or found by its runtime.
  func requireApp(_ appId: String) async throws(BridgeError) {
    guard catalog[appId] == nil, launcher[appId] == nil, unlisted[appId] == nil else { return }
    do {
      let runtime = try await services.client().appRuntime(appId: appId)
      unlisted[appId] = (runtime.name, try? WidgetLauncherWriter.icon(of: runtime))
    } catch {
      let key: ShellStringKey = Self.isGone(error) ? .userAppOpenMissing : .pinFailed
      throw BridgeError(ShellStrings.shared.text(key))
    }
  }
}
