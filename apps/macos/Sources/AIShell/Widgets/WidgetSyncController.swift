import AICore
import AIRelay
import AIWidgetModel
import AIWidgetRender
import Foundation
import OSLog
import WidgetKit

/// Keeps the WidgetKit extension's files in step with the service and tells the service which
/// widgets exist:
/// - **Pull.** On connecting and on every `invalidate` with scope `widgets`, it fetches
///   `GET /v1/widgets/snapshots`, writes it through ``WidgetFileWriter`` and
///   ``WidgetLauncherWriter`` (the shell is the only writer of that directory), then reloads the
///   App Widget's timelines, and the launcher's when its files changed.
/// - **Report.** The service renders only widgets the system shows, so the shell posts
///   `WidgetCenter`'s current configurations, as `{ kind, family }`, to
///   `POST /v1/widgets/instances` on connecting,
///   after each pull and every ten minutes, since WidgetKit announces no configuration change.
///   An unchanged list is not sent again to the same service instance. Only App Widget
///   instances count: the launcher needs no renders.
final class WidgetSyncController {
  private let services: ShellServices
  private let files: WidgetFiles?
  private var pulling = false
  private var pullAgain = false
  private var reported: [WidgetInstance]?
  /// Per launcher app, the icon revision whose icon the widget files hold
  /// (``WidgetLauncherWriter``). Empty after launch, so the first pull compares every icon once.
  private var launcherIcons: [String: Int] = [:]
  private var ticker: Task<Void, Never>?
  private static let reportInterval: Duration = .seconds(600)
  private static let log = Logger(subsystem: "com.junerdd.ai", category: "widgets")

  init(services: ShellServices, files: WidgetFiles?) {
    self.services = services
    self.files = files
  }

  /// Whether macOS can offer this build's widgets from where it runs (`app.state`).
  var isAvailable: Bool {
    WidgetPlacement.isIndexed(
      bundleURL: Bundle.main.bundleURL, home: FileManager.default.homeDirectoryForCurrentUser)
  }

  /// `userApp.widgetPreview`: the latest synced snapshot of the widget as PNG.
  func preview(_ params: UserAppWidgetPreviewParams) throws(BridgeError) -> String {
    guard let files, UserAppOrigin.isValidAppId(params.appId),
      WidgetSelection.isValidWidgetId(params.widgetId),
      let family = WidgetFamily(rawValue: params.family.rawValue)
    else { throw BridgeError("No preview of this widget is available.") }
    return try WidgetPreview.png(
      files: files, appId: params.appId, widgetId: params.widgetId, family: family)
  }

  /// Warns when macOS cannot show this build's widgets from where it runs, then reports the
  /// instances periodically. Without an Info.plist (tests, `swift run`) nothing runs.
  func start() {
    guard files != nil, ticker == nil else { return }
    if !isAvailable {
      Self.log.notice(
        "Atd runs outside /Applications and ~/Applications; macOS may not offer its widgets.")
    }
    ticker = Task { [weak self] in
      while !Task.isCancelled {
        try? await Task.sleep(for: Self.reportInterval)
        await self?.report()
      }
    }
  }

  /// The control stream (re)connected: maybe a new service instance, which knows no instances.
  func serviceDidConnect() {
    reported = nil
    pull()
  }

  /// `invalidate` scope `widgets`.
  func invalidated() { pull() }

  /// One pull at a time; a request during a pull runs one more afterwards.
  func pull() {
    guard let files else { return }
    guard !pulling else {
      pullAgain = true
      return
    }
    pulling = true
    Task {
      repeat {
        pullAgain = false
        await pullOnce(into: files)
      } while pullAgain
      pulling = false
      await report()
    }
  }

  private func pullOnce(into files: WidgetFiles) async {
    do {
      let client = try await services.client()
      let sync = try await client.widgetSync()
      let iconApps = Set(
        sync.launcher.filter { launcherIcons[$0.appId] != $0.iconRevision }.map(\.appId))
      var runtimes: [String: UserAppRuntime] = [:]
      for appId in Set(WidgetFileWriter.imageSources(of: sync).keys).union(iconApps) {
        // An app whose runtime fails keeps its images out (its widgets show placeholders) and its
        // launcher icon as it was, until a later pull.
        runtimes[appId] = try? await client.appRuntime(appId: appId)
      }
      try await WidgetFileWriter.write(
        sync, roots: runtimes.mapValues(\.webRootURL), to: files, at: .now)
      WidgetCenter.shared.reloadTimelines(ofKind: WidgetKinds.app)
      let launcher = try await WidgetLauncherWriter.write(
        sync.launcher, runtimes: runtimes, copied: launcherIcons, to: files)
      launcherIcons = launcher.icons
      if launcher.changed { WidgetCenter.shared.reloadTimelines(ofKind: WidgetKinds.launcher) }
    } catch {
      Self.log.error("Widget sync failed: \(String(describing: error), privacy: .public)")
    }
  }

  /// Posts the live instances when they changed since the last post to this service.
  func report() async {
    guard files != nil, let infos = try? await WidgetCenter.shared.currentConfigurations()
    else { return }
    let instances = infos.filter { $0.kind == WidgetKinds.app }.prefix(128).compactMap {
      info -> WidgetInstance? in
      // Which app widget an instance shows stays unknown here: reading it needs the
      // configuration intent's type, which only the extension may declare (v10). The service
      // renders every declared widget in each reported family.
      guard let family = WidgetFamily(info.family) else { return nil }
      return WidgetInstance(kind: info.kind, family: family, appId: nil, widgetId: nil)
    }
    guard instances != reported else { return }
    do {
      try await services.client().postWidgetInstances(instances)
      reported = instances
    } catch {
      Self.log.error(
        "Widget instances were not reported: \(String(describing: error), privacy: .public)")
    }
  }
}
