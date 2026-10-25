import AICore
import Foundation

/// Where the computer-use engines' executables are. The pinned Node that runs the browser worker
/// ships with the app, because the service needs it too: Release runs the copy the "Embed renderer
/// and service" phase of project.yml put in the bundle's Resources, Debug the checkout's staged
/// one (`pnpm --filter @atd/macos addons:pack`), located from this source file's compile-time
/// path, because the Debug app also runs from its mirror outside the checkout (dev-install.mjs).
/// The browser worker is an add-on the service installs: it comes only from the installs
/// ``AddonCatalog`` validated, and is nil while absent. The native engine's driver is not here:
/// it ships inside the app (``DriverLaunch/bundled(_:)``).
nonisolated struct EngineBinaries: Equatable, Sendable {
  /// The add-on of the browser engine and the entry naming its worker script.
  static let browserAddon = (id: "computer-browser", entry: "worker")

  /// The pinned Node that runs the browser worker; never a Node found on `PATH`.
  let node: URL
  /// The browser worker's entry (`apps/agent-service/src/computer/worker/server.ts`, built).
  let browserWorker: URL?

  init(node: URL, addons: AddonInstalls) {
    self.node = node
    browserWorker = addons.entry(Self.browserAddon.id, Self.browserAddon.entry)
  }

  /// This build's Node with the engines of `addons`.
  static func current(addons: AddonInstalls = .none, bundle: Bundle = .main) -> EngineBinaries {
    EngineBinaries(node: node(bundle: bundle), addons: addons)
  }

  /// The bundle's Node in Release, the checkout's in Debug.
  static func node(bundle: Bundle = .main) -> URL {
    #if DEBUG
      checkoutRoot().appending(path: "tmp/t7-node/bin/node", directoryHint: .notDirectory)
    #else
      (bundle.resourceURL ?? bundle.bundleURL)
        .appending(path: "node/bin/node", directoryHint: .notDirectory)
    #endif
  }

  /// The repository root: this file is `apps/macos/Sources/AIShell/Computer/Engines/` plus its
  /// name below it, so the root is seven path components up.
  static func checkoutRoot(sourceFile: String = #filePath) -> URL {
    var url = URL(filePath: sourceFile, directoryHint: .notDirectory)
    for _ in 0..<7 { url = url.deletingLastPathComponent() }
    return url
  }

  /// Whether `url` is an executable file now.
  static func isExecutable(_ url: URL) -> Bool {
    FileManager.default.isExecutableFile(atPath: url.path(percentEncoded: false))
  }

  /// Whether `url` is a readable file now.
  static func isReadable(_ url: URL) -> Bool {
    FileManager.default.isReadableFile(atPath: url.path(percentEncoded: false))
  }
}
