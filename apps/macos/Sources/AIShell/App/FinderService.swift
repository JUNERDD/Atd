import AppKit

/// The Finder entry (grill decision Q3): the "Add to Atd" service (`NSServices` in
/// `project.yml`, "Add to Atd Dev" in Debug builds, localized through `ServicesMenu.xcstrings`)
/// takes the selected files and folders. It is the app's `servicesProvider`; the system calls
/// ``addToAtd(_:userData:error:)``, the `NSMessage` of the Info.plist entry, on the main thread.
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
    let options: [NSPasteboard.ReadingOptionKey: Any] = [.urlReadingFileURLsOnly: true]
    let urls = pasteboard.readObjects(forClasses: [NSURL.self], options: options) as? [URL] ?? []
    guard !urls.isEmpty else {
      error.pointee = "No files or folders were selected." as NSString
      return
    }
    open(urls)
  }
}
