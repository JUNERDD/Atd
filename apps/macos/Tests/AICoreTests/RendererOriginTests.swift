import Foundation
import Testing

@testable import AICore

@Suite("Renderer origin lockdown")
struct RendererOriginTests {
  @Test("The main frame stays within ai-app://renderer; subframes load views; no new windows")
  func navigation() {
    let page = RendererOrigin.pageURL(fragment: "settings")
    #expect(page.absoluteString == "ai-app://renderer/#settings")
    #expect(
      RendererOrigin.pageURL(fragment: "settings?commandId=a%2Bb").absoluteString
        == "ai-app://renderer/#settings?commandId=a%2Bb")
    #expect(RendererOrigin.allowsNavigation(to: page, target: .mainFrame))
    #expect(!RendererOrigin.allowsNavigation(to: page, target: .subframe))
    #expect(!RendererOrigin.allowsNavigation(to: page, target: .newWindow))
    for url in [
      "https://example.com/", "ai-app://other/", "ai-app://renderer:8080/",
      "ai-app://user@renderer/", "about:blank", "file:///etc/hosts", "ai-view://view/t1/c1",
    ] {
      #expect(!RendererOrigin.allowsNavigation(to: URL(string: url), target: .mainFrame))
    }
    #expect(!RendererOrigin.allowsNavigation(to: nil, target: .mainFrame))
    let view = URL(string: "ai-view://view/t1/call_1?theme=dark&lang=en")
    #expect(RendererOrigin.allowsNavigation(to: view, target: .subframe))
    #expect(!RendererOrigin.allowsNavigation(to: view, target: .newWindow))
    #expect(!RendererOrigin.allowsNavigation(to: nil, target: .subframe))
  }

  @Test(
    "A subframe may load a well-formed view URL",
    arguments: [
      "ai-view://view/t1/c1", "ai-view://view/task_1-A/toolu_01AbC?theme=light&lang=zh-CN",
      "ai-view://view/t1/call_abc%7Cfc_1", "ai-view://view/t1/c1#section",
      "ai-view://view/t1/a%2Fb", "AI-VIEW://view/t1/c1", "ai-view://view/t1/%E4%B8%AD",
      "ai-view://view/t1/c1/widget", "ai-view://view/t1/c1/widget?theme=dark&lang=en",
      "ai-view://view/t1/widget", "ai-view://view/t1/widget/widget",
    ])
  func subframeViews(raw: String) {
    #expect(RendererOrigin.allowsNavigation(to: URL(string: raw), target: .subframe))
  }

  @Test(
    "A subframe loads nothing else: other origins, ports, credentials, other path shapes",
    arguments: [
      "https://example.com/", "ai-app://renderer/", "about:blank", "about:srcdoc",
      "data:text/html,x", "blob:ai-app://renderer/1", "ai-view://other/t1/c1",
      "ai-view://VIEW/t1/c1", "ai-view://view:8080/t1/c1", "ai-view://u@view/t1/c1",
      "ai-view://u:p@view/t1/c1", "ai-view://:@view/t1/c1", "ai-view:///t1/c1", "ai-view:/t1/c1",
      "ai-view://view", "ai-view://view/", "ai-view://view/t1", "ai-view://view/t1/",
      "ai-view://view/t1/c1/", "ai-view://view/t1/c1/x", "ai-view://view//c1",
      "ai-view://view/t1//", "ai-view-x://view/t1/c1",
      "ai-view://view/t1/c1/widget/", "ai-view://view/t1/c1/Widget", "ai-view://view/t1/c1/WIDGET",
      "ai-view://view/t1/c1/%77idget", "ai-view://view/t1/c1/widgets",
      "ai-view://view/t1/c1/widget/x", "ai-view://view/t1/c1//widget", "ai-view://view/t1//widget",
      "ai-view://view//c1/widget",
    ])
  func subframeRefused(raw: String) {
    #expect(!RendererOrigin.allowsNavigation(to: URL(string: raw), target: .subframe))
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

@Suite("View origin")
struct ViewOriginTests {
  @Test("Names the task and call once decoded, and re-encodes them for the service route")
  func document() throws {
    let url = URL(string: "ai-view://view/task_1-A/call_abc%7Cfc_1?theme=dark&lang=en#x")
    let view = try #require(ViewOrigin.document(of: url))
    #expect(view == ViewDocument(taskId: "task_1-A", callId: "call_abc|fc_1"))
    #expect(view.servicePath == "/v1/tasks/task_1-A/views/call_abc%7Cfc_1")
    let odd = try #require(ViewOrigin.document(of: URL(string: "ai-view://view/t/a%2Fb%20c%25")))
    #expect(odd.callId == "a/b c%")
    #expect(odd.servicePath == "/v1/tasks/t/views/a%2Fb%20c%25")
    let task = String(repeating: "a", count: 128)
    let call = String(repeating: "中", count: 256)
    let longest = URL(string: "ai-view://view/\(task)/\(RelayPath.encodeSegment(call))")
    #expect(ViewOrigin.document(of: longest) == ViewDocument(taskId: task, callId: call))
    let widget = try #require(
      ViewOrigin.document(of: URL(string: "ai-view://view/t1/a%2Fb/widget?theme=dark#x")))
    #expect(widget == ViewDocument(taskId: "t1", callId: "a/b", surface: .widget))
    #expect(widget.servicePath == "/v1/tasks/t1/views/a%2Fb/widget")
    #expect(
      ViewOrigin.document(taskId: "t1", callId: "c1", surface: .widget)
        == ViewDocument(taskId: "t1", callId: "c1", surface: .widget))
    #expect(ViewOrigin.document(taskId: "t 1", callId: "c1", surface: .window) == nil)
    #expect(ViewOrigin.document(taskId: "t1", callId: "..", surface: .window) == nil)
  }

  @Test(
    "Refuses foreign task ids, and call ids too long, with controls or dot segments",
    arguments: [
      "ai-view://view/t%201/c1", "ai-view://view/t.1/c1", "ai-view://view/t%2F1/c1",
      "ai-view://view/%E4%B8%AD/c1", "ai-view://view/\(String(repeating: "a", count: 129))/c1",
      "ai-view://view/t1/\(String(repeating: "c", count: 257))", "ai-view://view/t1/a%0Ab",
      "ai-view://view/t1/a%00", "ai-view://view/t1/a%7F", "ai-view://view/t1/a%C2%85",
      "ai-view://view/t1/.", "ai-view://view/t1/..", "ai-view://view/t1/%2e%2E",
      "ai-view://view/t1/%FF", "ai-view://view/%zz/c1",
      "ai-view://view/t%201/c1/widget", "ai-view://view/t1/../widget",
    ])
  func refused(raw: String) {
    #expect(ViewOrigin.document(of: URL(string: raw)) == nil)
  }
}
