import Foundation
import Testing

@testable import AICore

@Suite("Renderer origin lockdown")
struct RendererOriginTests {
  @Test("Only the main frame may navigate, and only within ai-app://renderer")
  func navigation() {
    let page = RendererOrigin.pageURL(fragment: "settings")
    #expect(page.absoluteString == "ai-app://renderer/#settings")
    #expect(
      RendererOrigin.pageURL(fragment: "settings?commandId=a%2Bb").absoluteString
        == "ai-app://renderer/#settings?commandId=a%2Bb")
    #expect(RendererOrigin.allowsNavigation(to: page, targetIsMainFrame: true))
    #expect(!RendererOrigin.allowsNavigation(to: page, targetIsMainFrame: false))
    for url in [
      "https://example.com/", "ai-app://other/", "ai-app://renderer:8080/",
      "ai-app://user@renderer/", "about:blank", "file:///etc/hosts",
    ] {
      #expect(!RendererOrigin.allowsNavigation(to: URL(string: url), targetIsMainFrame: true))
    }
    #expect(!RendererOrigin.allowsNavigation(to: nil, targetIsMainFrame: true))
  }

  @Test("Messages are trusted only from the renderer's main frame")
  func senders() {
    #expect(
      RendererOrigin.isTrustedSender(
        scheme: "ai-app", host: "renderer", port: 0, isMainFrame: true))
    #expect(
      !RendererOrigin.isTrustedSender(
        scheme: "ai-app", host: "renderer", port: 0, isMainFrame: false))
    #expect(
      !RendererOrigin.isTrustedSender(scheme: "https", host: "renderer", port: 0, isMainFrame: true)
    )
    #expect(
      !RendererOrigin.isTrustedSender(
        scheme: "ai-app", host: "renderer", port: 1, isMainFrame: true))
  }

  @Test("link.open opens http and https only")
  func links() {
    #expect(ExternalLink.openable("https://example.com/a?b#c") != nil)
    #expect(ExternalLink.openable("HTTP://example.com") != nil)
    for link in ["file:///tmp", "javascript:alert(1)", "ai-app://renderer/", "mailto:a@b", "http:"]
    {
      #expect(ExternalLink.openable(link) == nil)
    }
  }
}
