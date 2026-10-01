import Testing

@testable import AICore

@Suite("Relay headers")
struct RelayHeadersTests {
  @Test("Copies only allow-listed page headers and sets the credential and epoch itself")
  func request() {
    let page = [
      "content-type": "application/json", "ACCEPT": "application/json", "Range": "bytes=0-9",
      "Authorization": "Bearer page-token", "Cookie": "a=b", "Origin": "ai-app://renderer",
      "Content-Length": "12", "X-Relay-Epoch": "999", "Accept-Language": "zh-CN", "Host": "evil",
      "Connection": "upgrade", "If-None-Match": "\"x\"",
    ]
    let headers = RelayHeaders.forwardRequest(page, token: "main-token", epoch: 4)
    #expect(
      headers == [
        "Content-Type": "application/json", "Accept": "application/json", "Range": "bytes=0-9",
        "Authorization": "Bearer main-token", "x-relay-epoch": "4",
      ])
  }

  @Test("Copies only allow-listed service headers and adds the document defences")
  func response() {
    let upstream = [
      "content-type": "application/pdf", "content-length": "42",
      "content-disposition": "attachment; filename=\"a.pdf\"", "Set-Cookie": "s=1",
      "Location": "https://example.com", "x-service-id": "svc", "x-protocol-version": "1",
      "ETag": "\"e\"", "Content-Security-Policy": "default-src *", "Retry-After": "2",
    ]
    #expect(
      RelayHeaders.forwardResponse(upstream) == [
        "Content-Type": "application/pdf", "Content-Length": "42",
        "Content-Disposition": "attachment; filename=\"a.pdf\"", "Retry-After": "2",
        "Cache-Control": "no-store", "Content-Security-Policy": "sandbox; default-src 'none'",
        "X-Content-Type-Options": "nosniff",
      ])
  }

  @Test(
    "Keeps Content-Length only for bodies passed through unchanged",
    arguments: [
      (nil, true), ("identity", true), (" Identity ", true), ("", true), ("gzip", false),
      ("br", false),
    ] as [(String?, Bool)])
  func contentLength(encoding: String?, kept: Bool) {
    var upstream = ["Content-Length": "10"]
    upstream["Content-Encoding"] = encoding
    #expect((RelayHeaders.forwardResponse(upstream)["Content-Length"] != nil) == kept)
  }

  @Test("Keeps the service's own caching intent and range answers")
  func caching() {
    let upstream = [
      "Cache-Control": "max-age=60", "Content-Range": "bytes 0-9/100", "Accept-Ranges": "bytes",
    ]
    let headers = RelayHeaders.forwardResponse(upstream)
    #expect(headers["Cache-Control"] == "max-age=60")
    #expect(headers["Content-Range"] == "bytes 0-9/100")
    #expect(headers["Accept-Ranges"] == "bytes")
  }
}
