import Foundation
import Testing

@testable import AICore

@Suite("Static file resolution")
struct StaticFileResolverTests {
  /// A bundle root with a sibling secret, and symbolic links pointing inside and outside.
  private struct Fixture {
    let base: URL
    let root: URL
    let resolver: StaticFileResolver

    init() throws {
      let manager = FileManager.default
      base = manager.temporaryDirectory.appending(path: "aicore-static-\(UUID().uuidString)")
      root = base.appending(path: "renderer")
      try manager.createDirectory(
        at: root.appending(path: "assets"), withIntermediateDirectories: true)
      try Data("<!doctype html>".utf8).write(to: root.appending(path: "index.html"))
      try Data("js".utf8).write(to: root.appending(path: "assets/app.js"))
      try Data("hidden".utf8).write(to: root.appending(path: ".env"))
      try Data("secret".utf8).write(to: base.appending(path: "secret.txt"))
      try manager.createSymbolicLink(
        at: root.appending(path: "escape.txt"),
        withDestinationURL: base.appending(path: "secret.txt"))
      try manager.createSymbolicLink(
        at: root.appending(path: "escape-dir"), withDestinationURL: base)
      try manager.createSymbolicLink(
        at: root.appending(path: "alias.js"),
        withDestinationURL: root.appending(path: "assets/app.js"))
      resolver = StaticFileResolver(root: root)
    }

    func remove() { try? FileManager.default.removeItem(at: base) }

    func resolve(_ raw: String) throws -> URL? { resolver.resolve(try RelayPath.normalize(raw)) }
  }

  @Test("Serves index.html for the root and files inside the bundle")
  func servesFiles() throws {
    let fixture = try Fixture()
    defer { fixture.remove() }
    #expect(try fixture.resolve("/")?.lastPathComponent == "index.html")
    #expect(try fixture.resolve("/index.html")?.lastPathComponent == "index.html")
    let script = try #require(try fixture.resolve("/assets/app.js"))
    #expect(try String(contentsOf: script, encoding: .utf8) == "js")
  }

  @Test("Judges a symbolic link by where it finally lands")
  func followsInternalLinks() throws {
    let fixture = try Fixture()
    defer { fixture.remove() }
    #expect(try fixture.resolve("/alias.js")?.lastPathComponent == "app.js")
    // Leaves the root through the link, then comes back to a file that is inside it.
    let looped = try #require(try fixture.resolve("/escape-dir/renderer/index.html"))
    #expect(looped == fixture.resolver.root.appending(path: "index.html"))
  }

  @Test(
    "Answers nothing for directories, hidden names, missing files and links out of the bundle",
    arguments: [
      "/assets", "/.env", "/missing.js", "/assets/missing.js", "/escape.txt",
      "/escape-dir/secret.txt",
    ])
  func refuses(raw: String) throws {
    let fixture = try Fixture()
    defer { fixture.remove() }
    #expect(try fixture.resolve(raw) == nil)
  }

  @Test("Never reaches a sibling of the root through any path the normalizer accepts")
  func staysUnderRoot() throws {
    let fixture = try Fixture()
    defer { fixture.remove() }
    for raw in ["/%2e%2e/secret.txt", "/../secret.txt", "/assets/..%2Fsecret.txt"] {
      #expect(throws: RelayRequestError.self) { try fixture.resolve(raw) }
    }
  }
}
