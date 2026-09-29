import Foundation
import Testing

@testable import AICore

@Suite("Shell event outbox")
struct ShellEventOutboxTests {
  static func event(_ name: String, _ value: String) -> ShellEvent {
    ShellEvent(name: name, payload: .string(value))
  }

  @Test("Nothing goes out before the page is ready")
  func waitsForReady() {
    var outbox = ShellEventOutbox()
    outbox.setState("window.visibility", .bool(true))
    outbox.post(Self.event("command", "c1"))
    #expect(outbox.nextBatch() == nil)
    outbox.pageDidBecomeReady()
    #expect(
      outbox.nextBatch() == [
        ShellEvent(name: "window.visibility", payload: .bool(true)), Self.event("command", "c1"),
      ])
  }

  @Test("One call in flight; later events form the next batch")
  func oneInFlight() {
    var outbox = ShellEventOutbox()
    outbox.pageDidBecomeReady()
    outbox.post(Self.event("a", "1"))
    #expect(outbox.nextBatch() == [Self.event("a", "1")])
    outbox.post(Self.event("a", "2"))
    outbox.post(Self.event("a", "3"))
    #expect(outbox.nextBatch() == nil)
    outbox.batchDidFinish(delivered: true)
    #expect(outbox.nextBatch() == [Self.event("a", "2"), Self.event("a", "3")])
  }

  @Test("States send only their latest changed value")
  func latestState() {
    var outbox = ShellEventOutbox()
    outbox.pageDidBecomeReady()
    outbox.setState("active", .bool(true))
    outbox.setState("active", .bool(false))
    #expect(outbox.nextBatch() == [ShellEvent(name: "active", payload: .bool(false))])
    outbox.batchDidFinish(delivered: true)
    outbox.setState("active", .bool(false))
    #expect(outbox.nextBatch() == nil)
  }

  @Test("A crash replays one-shots in order and every state to the rebuilt page")
  func crashReplay() {
    var outbox = ShellEventOutbox()
    outbox.pageDidBecomeReady()
    outbox.setState("language", .string("en"))
    outbox.post(Self.event("command", "c1"))
    #expect(outbox.nextBatch()?.count == 2)
    outbox.post(Self.event("command", "c2"))
    outbox.pageDidUnload()
    outbox.batchDidFinish(delivered: false)
    #expect(outbox.nextBatch() == nil)
    outbox.pageDidBecomeReady()
    #expect(
      outbox.nextBatch() == [
        ShellEvent(name: "language", payload: .string("en")),
        Self.event("command", "c1"), Self.event("command", "c2"),
      ])
  }

  @Test("A reloaded page receives the current states again")
  func reloadResendsStates() {
    var outbox = ShellEventOutbox()
    outbox.setState("active", .bool(true))
    outbox.pageDidBecomeReady()
    _ = outbox.nextBatch()
    outbox.batchDidFinish(delivered: true)
    outbox.pageDidUnload()
    outbox.pageDidBecomeReady()
    #expect(outbox.nextBatch() == [ShellEvent(name: "active", payload: .bool(true))])
  }
}

@Suite("Renderer origin lockdown")
struct RendererOriginTests {
  @Test("Only the main frame may navigate, and only within ai-app://renderer")
  func navigation() {
    let page = RendererOrigin.pageURL(fragment: "settings")
    #expect(page.absoluteString == "ai-app://renderer/#settings")
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

  @Test("openLink opens http and https only")
  func links() {
    #expect(ExternalLink.openable("https://example.com/a?b#c") != nil)
    #expect(ExternalLink.openable("HTTP://example.com") != nil)
    for link in ["file:///tmp", "javascript:alert(1)", "ai-app://renderer/", "mailto:a@b", "http:"]
    {
      #expect(ExternalLink.openable(link) == nil)
    }
  }
}
