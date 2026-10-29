import Foundation
import os

/// Turns on the embedded Finder Sync extension (`AtdFinderSync`, the Finder entry at the top of
/// the context menu): macOS registers a new Finder Sync extension disabled, and the entry would
/// otherwise stay hidden until the person found it in System Settings. Only an extension nobody
/// has decided on yet is turned on, so switching it off in System Settings sticks.
nonisolated enum FinderExtension {
  private static let log = Logger(subsystem: "com.junerdd.ai", category: "finder-sync")
  private static let pluginkit = URL(fileURLWithPath: "/usr/bin/pluginkit")

  /// Does nothing for a build without the extension in `Contents/PlugIns` (a Debug build run from
  /// DerivedData keeps it staged) or before the system has registered it; the next launch tries
  /// again.
  @concurrent
  static func enableIfUndecided() async {
    guard
      let plugIns = Bundle.main.builtInPlugInsURL,
      let identifier = Bundle(url: plugIns.appending(path: "AtdFinderSync.appex"))?
        .bundleIdentifier,
      let listing = run(["-m", "-i", identifier])
    else { return }
    // `pluginkit -m` starts each extension's line with the election: `+` on, `-` off, a space for
    // none. An unregistered one has no line, only "(no matches)".
    let line = listing.split(separator: "\n").first { $0.contains("\(identifier)(") }
    guard let line, line.hasPrefix(" ") else { return }
    if run(["-e", "use", "-i", identifier]) != nil {
      log.notice("Enabled the Finder Sync extension")
    }
  }

  /// `pluginkit` with `arguments`: its output, or nil when it did not run or failed.
  private static func run(_ arguments: [String]) -> String? {
    let process = Process()
    let output = Pipe()
    process.executableURL = pluginkit
    process.arguments = arguments
    process.standardInput = FileHandle.nullDevice
    process.standardOutput = output
    process.standardError = FileHandle.nullDevice
    do {
      try process.run()
    } catch {
      log.error("pluginkit did not run: \(error)")
      return nil
    }
    let data = output.fileHandleForReading.readDataToEndOfFile()
    process.waitUntilExit()
    guard process.terminationStatus == 0 else {
      log.error("pluginkit \(arguments, privacy: .public) exited with \(process.terminationStatus)")
      return nil
    }
    return String(decoding: data, as: UTF8.self)
  }
}
