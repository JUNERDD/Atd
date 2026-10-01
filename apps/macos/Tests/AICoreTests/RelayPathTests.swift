import Foundation
import Testing

@testable import AICore

@Suite("Relay path normalization")
struct RelayPathTests {
  @Test(
    "Accepts canonical paths",
    arguments: [
      ("/", [String]()),
      ("/v1", ["v1"]),
      ("/v1/tasks", ["v1", "tasks"]),
      ("/assets/index-Dx9_a.js", ["assets", "index-Dx9_a.js"]),
      ("/v1/tasks/abc-123_~", ["v1", "tasks", "abc-123_~"]),
      ("/v1/skills/%E4%B8%AD", ["v1", "skills", "中"]),
      ("/v1/a%20b", ["v1", "a b"]),
      ("/v1/%74asks", ["v1", "tasks"]),
      ("/v1/x/...", ["v1", "x", "..."]),
      ("/v1/x/a:b@c!$&'()*+,;=", ["v1", "x", "a:b@c!$&'()*+,;="]),
    ])
  func accepts(raw: String, segments: [String]) throws {
    #expect(try RelayPath.normalize(raw).segments == segments)
  }

  @Test(
    "Re-encodes every byte outside unreserved",
    arguments: [
      ("/v1/%74asks", "/v1/tasks"),
      ("/v1/a%20b", "/v1/a%20b"),
      ("/v1/%7e", "/v1/~"),
      ("/v1/x/a:b", "/v1/x/a%3Ab"),
      ("/v1/skills/%e4%b8%ad", "/v1/skills/%E4%B8%AD"),
      ("/", "/"),
    ])
  func encodes(raw: String, encoded: String) throws {
    #expect(try RelayPath.normalize(raw).encoded == encoded)
  }

  @Test(
    "Rejects dot segments, literal or encoded",
    arguments: [
      "/..", "/.", "/v1/../admin", "/v1/./tasks", "/v1/%2e%2e/admin", "/v1/%2E%2E/admin",
      "/v1/.%2e/admin", "/v1/%2e./admin", "/%2e", "/v1/tasks/..",
    ])
  func rejectsDotSegments(raw: String) {
    #expect(throws: RelayRequestError.dotSegment) { try RelayPath.normalize(raw) }
  }

  @Test(
    "Rejects escapes of separators, percent and controls, which also stops double decoding",
    arguments: [
      "/v1/a%2Fb", "/v1/a%2fb", "/v1/a%5Cb", "/v1/a%5cb", "/v1/%252e%252e/admin", "/v1/%252F",
      "/v1/%255C", "/v1/a%25", "/v1/a%00", "/v1/a%0A", "/v1/a%0d", "/v1/a%1F", "/v1/a%7F",
    ])
  func rejectsForbiddenEscapes(raw: String) {
    #expect(throws: RelayRequestError.forbiddenEscape) { try RelayPath.normalize(raw) }
  }

  @Test("Rejects malformed escapes", arguments: ["/v1/a%", "/v1/a%2", "/v1/a%zz", "/v1/%G0/x"])
  func rejectsMalformedEscapes(raw: String) {
    #expect(throws: RelayRequestError.malformedEscape) { try RelayPath.normalize(raw) }
  }

  @Test(
    "Rejects raw characters outside pchar",
    arguments: [
      "/v1/a\\b", "/v1\\..\\admin", "/v1/a b", "/v1/a\u{0}b", "/v1/a\nb", "/v1/a\tb", "/v1/é",
      "/v1/a?b", "/v1/a#b", "/v1/a\"b", "/v1/<x>", "/v1/a|b", "/v1/{x}",
    ])
  func rejectsForbiddenCharacters(raw: String) {
    #expect(throws: RelayRequestError.forbiddenCharacter) { try RelayPath.normalize(raw) }
  }

  @Test("Rejects empty segments", arguments: ["//v1", "/v1//tasks", "/v1/tasks/", "//"])
  func rejectsEmptySegments(raw: String) {
    #expect(throws: RelayRequestError.emptySegment) { try RelayPath.normalize(raw) }
  }

  @Test(
    "Rejects decoded bytes that are not UTF-8", arguments: ["/v1/%FF", "/v1/%C3", "/v1/%C0%AF"])
  func rejectsInvalidUTF8(raw: String) {
    #expect(throws: RelayRequestError.invalidUTF8) { try RelayPath.normalize(raw) }
  }

  @Test("Rejects relative and oversized paths")
  func rejectsShape() throws {
    #expect(throws: RelayRequestError.notAbsolute) { try RelayPath.normalize("") }
    #expect(throws: RelayRequestError.notAbsolute) { try RelayPath.normalize("v1/tasks") }
    let long = "/" + String(repeating: "a", count: RelayPath.maxLength)
    #expect(throws: RelayRequestError.tooLong) { try RelayPath.normalize(long) }
    let limit = "/" + String(repeating: "a", count: RelayPath.maxLength - 1)
    #expect(try RelayPath.normalize(limit).segments.count == 1)
  }

  @Test("Routes /v1 to the relay with its query and everything else to the bundle")
  func classifies() throws {
    let api = try RelayPath.classify(
      try #require(URL(string: "ai-app://renderer/v1/tasks?limit=10")))
    #expect(api == .api(try RelayPath.normalize("/v1/tasks"), query: "limit=10"))
    let bare = try RelayPath.classify(try #require(URL(string: "ai-app://renderer/v1/tasks")))
    #expect(bare == .api(try RelayPath.normalize("/v1/tasks"), query: nil))
    let root = try RelayPath.classify(try #require(URL(string: "ai-app://renderer/")))
    #expect(root == .asset(try RelayPath.normalize("/")))
    let asset = try RelayPath.classify(
      try #require(URL(string: "ai-app://renderer/assets/a.js?v=1")))
    #expect(asset == .asset(try RelayPath.normalize("/assets/a.js")))
    let upper = try RelayPath.classify(try #require(URL(string: "ai-app://renderer/V1/tasks")))
    #expect(upper == .asset(try RelayPath.normalize("/V1/tasks")))
  }

  @Test(
    "Refuses other origins",
    arguments: [
      "https://renderer/v1/tasks", "ai-app://other/v1/tasks", "ai-app://user@renderer/v1/tasks",
      "ai-app://user:pw@renderer/", "ai-app://renderer:8080/v1/tasks", "ai-app:///v1/tasks",
    ])
  func refusesOtherOrigins(url: String) throws {
    let url = try #require(URL(string: url))
    #expect(throws: RelayRequestError.wrongOrigin) { try RelayPath.classify(url) }
  }

  @Test("Normalizes the path of a real URL, since Foundation does not resolve dot segments")
  func normalizesURLPaths() throws {
    let dotted = try #require(URL(string: "ai-app://renderer/v1/%2e%2e/admin/routes"))
    #expect(throws: RelayRequestError.dotSegment) { try RelayPath.classify(dotted) }
    let slashed = try #require(URL(string: "ai-app://renderer/v1/plugins/a%2Fb/enabled"))
    #expect(throws: RelayRequestError.forbiddenEscape) { try RelayPath.classify(slashed) }
    let double = try #require(URL(string: "ai-app://renderer/assets/%252e%252e/secret"))
    #expect(throws: RelayRequestError.forbiddenEscape) { try RelayPath.classify(double) }
  }

  @Test("Refuses a backslash even after Foundation percent-encodes it")
  func refusesEncodedBackslash() throws {
    let url = try #require(URL(string: "ai-app://renderer/v1\\..\\admin/routes"))
    #expect(url.path(percentEncoded: true).contains("%5C"))
    #expect(throws: RelayRequestError.forbiddenEscape) { try RelayPath.classify(url) }
  }

  @Test("Forwards the percent-encoded query unchanged")
  func keepsQuery() throws {
    let url = try #require(URL(string: "ai-app://renderer/v1/tasks?a={b}&c=d/e?f"))
    let expected = try RelayPath.normalize("/v1/tasks")
    #expect(try RelayPath.classify(url) == .api(expected, query: "a=%7Bb%7D&c=d/e?f"))
  }
}
