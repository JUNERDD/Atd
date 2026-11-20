import Foundation
import Testing

@testable import AtdShareUI

/// `Share/SharePage.js` run the way Atd runs it for a link another app shared: in a web page of
/// its own, which hands back the page's title and text.
@MainActor @Suite struct PageReaderTests {
  /// The script Safari and the reader run, from the source tree.
  private static func script() throws -> String {
    let root = URL(filePath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
      .deletingLastPathComponent()
    return try String(contentsOf: root.appending(path: "Share/SharePage.js"), encoding: .utf8)
  }

  @Test(.timeLimit(.minutes(1))) func aLoadedPageGivesItsTitleAndText() async throws {
    let html = "<title>城市读书会</title><body><h1>11 月共读</h1><p>周六 14:00 静安图书馆</p></body>"
    let url = try #require(
      URL(
        string: "data:text/html;charset=utf-8,"
          + (html.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? "")))
    let page = try await WebPageReader(script: Self.script()).read(url)
    #expect(page.url == url)
    #expect(page.title == "城市读书会")
    #expect(page.text?.contains("周六 14:00 静安图书馆") == true)
  }

  @Test(.timeLimit(.minutes(1))) func aPageWithNoTextIsUnreadable() async throws {
    let url = try #require(URL(string: "data:text/html;charset=utf-8,%3Cbody%3E%3C%2Fbody%3E"))
    await #expect(throws: PageFailure.unreadable) {
      try await WebPageReader(script: Self.script()).read(url)
    }
  }
}
