import AIWidgetModel
import AppKit
import FinderSync
import os

/// The top-level Finder entry: "Add to Atd" ("Add to Atd Dev" in Debug builds) in the context
/// menu of selected files and folders, next to Quick Actions, a place the app's Services entry
/// (`FinderService`) cannot reach. Finder runs this sandboxed extension while it is enabled in
/// System Settings; it observes the whole disk only so the entry shows everywhere, and badges
/// nothing.
///
/// The extension cannot read the selected items, so it hands their URLs to the containing app
/// through ``FinderHandoff``, and the app imports them as it imports the service's.
final class FinderSyncExtension: FIFinderSync {
  /// Atd.app, which embeds this extension in `Contents/PlugIns`.
  private static let hostApp = Bundle.main.bundleURL
    .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
  private static let log = Logger(subsystem: "com.junerdd.ai", category: "finder-sync")

  override init() {
    super.init()
    FIFinderSyncController.default().directoryURLs = [URL(fileURLWithPath: "/")]
  }

  override func menu(for menuKind: FIMenuKind) -> NSMenu? {
    guard menuKind == .contextualMenuForItems, let title = Self.title else { return nil }
    let menu = NSMenu(title: "")
    let item = menu.addItem(withTitle: title, action: #selector(addToAtd(_:)), keyEquivalent: "")
    let icon = NSWorkspace.shared.icon(forFile: Self.hostApp.path)
    icon.size = NSSize(width: 16, height: 16)
    item.image = icon
    return menu
  }

  @objc func addToAtd(_ sender: AnyObject?) {
    guard let items = FIFinderSyncController.default().selectedItemURLs(), !items.isEmpty,
      let scheme = WidgetLink.mainBundleScheme, let link = FinderHandoff.url(scheme: scheme),
      let hostBundleId = Bundle.main.object(forInfoDictionaryKey: WidgetFiles.hostBundleIdKey)
        as? String
    else { return }
    let name = FinderHandoff.pasteboardName(hostBundleId: hostBundleId)
    let pasteboard = NSPasteboard(name: NSPasteboard.Name(name))
    pasteboard.clearContents()
    guard pasteboard.writeObjects(items.map { $0 as NSURL }) else {
      return Self.log.error("The selected items could not be written for Atd.")
    }
    NSWorkspace.shared.open(
      [link], withApplicationAt: Self.hostApp, configuration: NSWorkspace.OpenConfiguration()
    ) { _, error in
      if let error { Self.log.error("Atd did not open the hand-off: \(error, privacy: .public)") }
    }
  }

  /// The Services entry's title (`AtdServiceMenuTitle`, project.yml `AI_SERVICE_MENU_TITLE`) in
  /// the system language, from the same String Catalog, so both entries read alike.
  private static var title: String? {
    guard let key = Bundle.main.object(forInfoDictionaryKey: "AtdServiceMenuTitle") as? String
    else { return nil }
    return Bundle.main.localizedString(forKey: key, value: key, table: "ServicesMenu")
  }
}
