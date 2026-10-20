import Foundation
import Testing

@testable import AICore

@Suite("Relay replay policy (R4)")
struct RelayPolicyTests {
  private static let marked = ["x-relay-epoch-current": "8"]

  @Test("Replays once only a 409 that names the current epoch")
  func replaysMarkedConflictOnce() {
    #expect(
      RelayPolicy.followUp(status: 409, headers: Self.marked, replayed: false)
        == .refetchManifestAndReplay)
    #expect(RelayPolicy.followUp(status: 409, headers: Self.marked, replayed: true) == .deliver)
  }

  @Test("Matches the header name case-insensitively")
  func headerCase() {
    #expect(
      RelayPolicy.followUp(status: 409, headers: ["X-Relay-Epoch-Current": "8"], replayed: false)
        == .refetchManifestAndReplay)
  }

  @Test(
    "Delivers business conflicts and every other status unchanged",
    arguments: [
      (409, [String: String]()), (409, ["x-relay-epoch": "8"]), (200, marked), (400, marked),
      (403, marked), (503, marked),
    ])
  func delivers(status: Int, headers: [String: String]) {
    #expect(RelayPolicy.followUp(status: status, headers: headers, replayed: false) == .deliver)
  }
}

@Suite("Relay request gate (R7)")
struct RelayRequestGateTests {
  @Test("Takes requests without Origin (navigations) and from the renderer origin")
  func acceptsRendererOrigin() {
    #expect(RelayRequestGate.checkOrigin(headers: [:]) == nil)
    #expect(RelayRequestGate.checkOrigin(headers: ["Origin": "ai-app://renderer"]) == nil)
    #expect(RelayRequestGate.checkOrigin(headers: ["origin": "ai-app://renderer"]) == nil)
  }

  @Test(
    "Refuses every other Origin, including null and near misses",
    arguments: [
      "null", "", "https://example.com", "ai-app://renderer.evil", "ai-app://renderer:1",
      "ai-app://Renderer", "AI-APP://renderer", "ai-app://renderer/", "ai-app-other://renderer",
      "http://127.0.0.1:5173",
    ])
  func refusesForeignOrigin(origin: String) {
    #expect(RelayRequestGate.checkOrigin(headers: ["Origin": origin]) == .foreignOrigin)
  }

  @Test("Takes requests of renderer documents and requests without a document")
  func documents() {
    #expect(RelayRequestGate.checkDocument(nil) == nil)
    #expect(RelayRequestGate.checkDocument(URL(string: "ai-app://renderer/")) == nil)
    #expect(RelayRequestGate.checkDocument(URL(string: "ai-app://renderer/settings.html#x")) == nil)
    for other in [
      "ai-app-other://page/", "https://example.com/", "ai-app://renderer.evil/",
      "ai-app://renderer:8/", "ai-app://u@renderer/", "about:blank", "file:///tmp/a.html",
    ] {
      #expect(RelayRequestGate.checkDocument(URL(string: other)) == .foreignOrigin)
    }
  }

  @Test("GET and HEAD need no relay marker")
  func safeMethods() {
    #expect(RelayRequestGate.checkAPI(method: "GET", headers: [:]) == nil)
    #expect(RelayRequestGate.checkAPI(method: "HEAD", headers: [:]) == nil)
  }

  @Test(
    "Other methods need exactly x-ai-relay: 1",
    arguments: ["POST", "PUT", "PATCH", "DELETE", "OPTIONS", "get", "PROPFIND"])
  func stateChangingMethods(method: String) {
    #expect(RelayRequestGate.checkAPI(method: method, headers: [:]) == .missingRelayMarker)
    #expect(
      RelayRequestGate.checkAPI(method: method, headers: ["x-ai-relay": "0"])
        == .missingRelayMarker)
    #expect(
      RelayRequestGate.checkAPI(method: method, headers: ["x-ai-relay": "true"])
        == .missingRelayMarker)
    #expect(RelayRequestGate.checkAPI(method: method, headers: ["X-AI-Relay": "1"]) == nil)
    #expect(RelayRequestGate.checkAPI(method: method, headers: ["x-ai-relay": " 1 "]) == nil)
  }

  @Test("Renderer files take GET and HEAD only")
  func assets() {
    #expect(RelayRequestGate.checkAsset(method: "GET") == nil)
    #expect(RelayRequestGate.checkAsset(method: "HEAD") == nil)
    for method in ["POST", "PUT", "DELETE", "get"] {
      #expect(RelayRequestGate.checkAsset(method: method) == .methodNotAllowed)
    }
  }
}

@Suite("View request gate")
struct ViewRequestGateTests {
  private static let view = URL(string: "ai-view://view/t1/c1?theme=dark&lang=en")
  private static let renderer = URL(string: "ai-app://renderer/#settings")

  private static func check(
    _ method: String = "GET", url: URL? = view, headers: [String: String] = [:],
    document: URL? = renderer
  ) -> Result<ViewDocument, ViewRequestGate.Refusal> {
    ViewRequestGate.check(method: method, url: url, headers: headers, mainDocumentURL: document)
  }

  @Test("Serves GET and HEAD under the renderer page, with no Origin or the renderer's")
  func serves() {
    let view = ViewDocument(taskId: "t1", callId: "c1")
    #expect(Self.check() == .success(view))
    #expect(Self.check("HEAD") == .success(view))
    #expect(Self.check(headers: ["Origin": "ai-app://renderer"]) == .success(view))
  }

  @Test(
    "Refuses requests whose main document is not the renderer page",
    arguments: [
      "ai-view://view/t1/c1", "ai-app-other://page/", "https://example.com/",
      "ai-app://renderer:1/", "ai-app://u@renderer/", "about:blank",
    ])
  func refusesForeignDocument(document: String) {
    #expect(Self.check(document: URL(string: document)) == .failure(.foreignDocument))
  }

  @Test("Refuses requests without a main document, or with another Origin")
  func refusesForeignOrigin() {
    #expect(Self.check(document: nil) == .failure(.foreignDocument))
    #expect(Self.check(headers: ["Origin": "null"]) == .failure(.foreignDocument))
    #expect(Self.check(headers: ["origin": "ai-view://view"]) == .failure(.foreignDocument))
  }

  @Test("Takes GET and HEAD only, then a view's URL only")
  func refusesMethodsAndURLs() {
    for method in ["POST", "PUT", "DELETE", "OPTIONS", "get"] {
      #expect(Self.check(method) == .failure(.methodNotAllowed))
    }
    for url in ["ai-view://view/t1", "ai-view://view/t%2F1/c1", "ai-app://renderer/v1/echo"] {
      #expect(Self.check(url: URL(string: url)) == .failure(.notFound))
    }
    #expect(Self.check(url: nil) == .failure(.notFound))
    #expect(ViewRequestGate.Refusal.foreignDocument.status == 403)
    #expect(ViewRequestGate.Refusal.methodNotAllowed.status == 405)
    #expect(ViewRequestGate.Refusal.notFound.status == 404)
  }
}

@Suite("Relay error bodies and renderer MIME types")
struct RelayResponseTests {
  @Test("Relay errors use the service's error envelope")
  func envelope() throws {
    let body = String(decoding: RelayErrorBody.json(status: 403, message: "No."), as: UTF8.self)
    #expect(body == #"{"error":{"code":"forbidden","message":"No."}}"#)
    #expect(RelayErrorBody.code(for: 503) == "internal")
    #expect(RelayErrorBody.code(for: 404) == "not_found")
  }

  @Test("Maps build file types and never guesses unknown ones")
  func mime() {
    #expect(RendererMIMEType.forFile(named: "index.html") == "text/html; charset=utf-8")
    #expect(RendererMIMEType.forFile(named: "a.B3c.JS") == "text/javascript; charset=utf-8")
    #expect(RendererMIMEType.forFile(named: "inter.woff2") == "font/woff2")
    #expect(RendererMIMEType.forFile(named: "README") == RendererMIMEType.fallback)
    #expect(RendererMIMEType.forFile(named: ".html") == RendererMIMEType.fallback)
    #expect(RendererMIMEType.forFile(named: "x.exe") == RendererMIMEType.fallback)
    #expect(RendererMIMEType.isHTML("text/html"))
    #expect(RendererMIMEType.isHTML("Text/HTML; charset=utf-8"))
    #expect(!RendererMIMEType.isHTML("text/html-sandboxed"))
    #expect(!RendererMIMEType.isHTML(nil))
  }
}
