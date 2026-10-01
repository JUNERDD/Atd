import Foundation
import Testing
import UniformTypeIdentifiers

@testable import AICore

@Suite("Artifact open policy")
struct ArtifactOpenPolicyTests {
  /// The decision for the type the system gives an extension, as the shell asks for it.
  static func decision(forExtension name: String) -> ArtifactOpenPolicy.Decision {
    let type = UTType(filenameExtension: name)
    return ArtifactOpenPolicy.decision(
      typeIdentifier: type?.identifier, conformsTo: type?.supertypes.map(\.identifier) ?? [])
  }

  @Test(
    "Documents open directly",
    arguments: [
      "pdf", "png", "jpg", "heic", "gif", "txt", "md", "csv", "tsv", "json", "rtf", "log",
      "swift", "docx", "doc", "xlsx", "xls", "pptx", "ppt", "odt", "pages", "numbers", "key",
      "mp3", "m4a", "wav", "mp4", "mov",
    ])
  func documents(name: String) {
    #expect(Self.decision(forExtension: name) == .openDirectly, "\(name)")
  }

  @Test(
    "Executables, scripts, apps and macro documents ask",
    arguments: [
      "command", "sh", "py", "js", "scpt", "applescript", "jar", "app", "exe", "dylib", "docm",
      "xlsm", "pptm",
    ])
  func code(name: String) {
    #expect(Self.decision(forExtension: name) == .askFirst, "\(name)")
  }

  @Test(
    "Archives, installers, disk images and location shortcuts ask",
    arguments: [
      "zip", "tar", "gz", "bin", "xip", "pkg", "mpkg", "dmg", "iso", "webloc", "inetloc", "fileloc",
      "url",
    ])
  func containersAndShortcuts(name: String) {
    #expect(Self.decision(forExtension: name) == .askFirst, "\(name)")
  }

  @Test(
    "Active content and types that are not known documents ask",
    arguments: [
      "svg", "html", "xml", "yaml", "plist", "terminal", "shortcut", "workflow", "scptd", "ics",
      "vcf", "webarchive",
    ])
  func unknown(name: String) {
    #expect(Self.decision(forExtension: name) == .askFirst, "\(name)")
  }

  @Test("An untyped, dynamic or bare data file asks")
  func untyped() {
    #expect(ArtifactOpenPolicy.decision(typeIdentifier: nil, conformsTo: []) == .askFirst)
    #expect(
      ArtifactOpenPolicy.decision(
        typeIdentifier: "dyn.ah62d4rv4ge81s55wrrxg2551", conformsTo: ["public.data", "public.item"])
        == .askFirst)
    #expect(
      ArtifactOpenPolicy.decision(typeIdentifier: "public.data", conformsTo: ["public.item"])
        == .askFirst)
  }

  @Test("A code conformance wins over a document one, and identifiers ignore case")
  func precedence() {
    #expect(
      ArtifactOpenPolicy.decision(
        typeIdentifier: "com.example.viewer-bundle",
        conformsTo: ["public.image", "com.apple.bundle"])
        == .askFirst)
    #expect(
      ArtifactOpenPolicy.decision(typeIdentifier: "COM.ADOBE.PDF", conformsTo: []) == .openDirectly)
    #expect(
      ArtifactOpenPolicy.decision(
        typeIdentifier: "com.example.tool", conformsTo: ["Public.Executable", "public.plain-text"])
        == .askFirst)
  }

  @Test("The shown name drops invisible formatting characters")
  func displayName() {
    #expect(ArtifactOpenPolicy.displayName("report\u{202E}fdp.command") == "reportfdp.command")
    #expect(ArtifactOpenPolicy.displayName("a\u{200B}b.app") == "ab.app")
    #expect(ArtifactOpenPolicy.displayName("报告 final.pdf") == "报告 final.pdf")
  }
}
