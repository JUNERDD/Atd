import AICore
import Foundation
import MCP
import Testing

@testable import AIShell

/// How one browser worker tool result becomes the host's reply. Since swift-sdk 0.12 a text item
/// also carries `annotations` and `_meta`; a refusal must still surface its text.
@Suite("Browser worker results")
struct BrowserWorkerResultTests {
  /// A tool result as the worker's MCP server writes it on the wire.
  static func result(_ json: String) throws -> CallTool.Result {
    try JSONDecoder().decode(CallTool.Result.self, from: Data(json.utf8))
  }

  static func text(_ text: String) -> Tool.Content {
    .text(text: text, annotations: nil, _meta: nil)
  }

  @Test("A refusal without structured content surfaces its text items, joined")
  func refusalJoinsText() throws {
    let result = try Self.result(
      """
      {"isError": true, "content": [
        {"type": "text", "text": "MCP error -32602:", "annotations": {"priority": 0.5}},
        {"type": "image", "data": "AA==", "mimeType": "image/png"},
        {"type": "text", "text": "Invalid arguments for tool fill", "_meta": {"source": "sdk"}}
      ]}
      """)
    #expect(
      throws: BrowserWorkerCallError.rejected("MCP error -32602: Invalid arguments for tool fill")
    ) { try BrowserWorkerProcess.reply(result, of: "fill") }
  }

  @Test("A refusal's joined text is cut to 500 characters")
  func refusalTruncates() {
    let first = String(repeating: "é", count: 300)
    let second = String(repeating: "b", count: 300)
    let result = CallTool.Result(content: [Self.text(first), Self.text(second)], isError: true)
    let expected = first + " " + String(repeating: "b", count: 199)
    #expect(expected.count == 500)
    #expect(throws: BrowserWorkerCallError.rejected(expected)) {
      try BrowserWorkerProcess.reply(result, of: "observe")
    }
  }

  @Test("Structured content decodes as the worker's reply, whatever text accompanies it")
  func structuredContentDecodes() throws {
    let result = try Self.result(
      """
      {"content": [{"type": "text", "text": "summary"}],
       "structuredContent": {"ok": true, "dispatched": true, "pageId": "page-1"}}
      """)
    let reply = try BrowserWorkerProcess.reply(result, of: "navigate")
    #expect(reply.ok)
    #expect(reply.dispatched)
    #expect(reply.pageId == "page-1")
  }
}
