import AIWidgetModel
import AppKit

/// The Finder entries (grill decision Q3), which take the selected files and folders:
/// - the "Add to Atd" service (`NSServices` in `project.yml`, "Add to Atd Dev" in Debug builds,
///   localized through `ServicesMenu.xcstrings`), listed under Services. This is the app's
///   `servicesProvider`; the system calls ``addToAtd(_:userData:error:)``, the `NSMessage` of the
///   Info.plist entry, on the main thread;
/// - the same title at the top of Finder's context menu, from the `AtdFinderSync` extension,
///   whose link ``openHandoff(_:)`` takes (``FinderHandoff``).
final class FinderService: NSObject {
  private let open: ([URL]) -> Void

  /// `open` receives the file URLs of each request; ``ShellController/openItems(_:)``.
  init(open: @escaping ([URL]) -> Void) {
    self.open = open
  }

  @objc func addToAtd(
    _ pasteboard: NSPasteboard, userData: String?,
    error: AutoreleasingUnsafeMutablePointer<NSString?>
  ) {
    let urls = Self.fileURLs(on: pasteboard)
    guard !urls.isEmpty else {
      error.pointee = "No files or folders were selected." as NSString
      return
    }
    open(urls)
  }

  /// False when `url` is not the Finder Sync extension's link. Otherwise imports the items the
  /// extension left on the hand-off pasteboard and releases it, so a later link finds nothing.
  func openHandoff(_ url: URL) -> Bool {
    guard let scheme = WidgetLink.mainBundleScheme, FinderHandoff.matches(url, scheme: scheme),
      let hostBundleId = Bundle.main.bundleIdentifier
    else { return false }
    let name = FinderHandoff.pasteboardName(hostBundleId: hostBundleId)
    let pasteboard = NSPasteboard(name: NSPasteboard.Name(name))
    let urls = Self.fileURLs(on: pasteboard)
    pasteboard.releaseGlobally()
    open(urls)
    return true
  }

  private static func fileURLs(on pasteboard: NSPasteboard) -> [URL] {
    let options: [NSPasteboard.ReadingOptionKey: Any] = [.urlReadingFileURLsOnly: true]
    return pasteboard.readObjects(forClasses: [NSURL.self], options: options) as? [URL] ?? []
  }
}
