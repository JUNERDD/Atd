import Foundation
import Testing

@testable import AICore

@Suite("MCP launch approval details and dialog")
struct McpApprovalDialogTests {
  static let fingerprint = String(repeating: "a1", count: 32)

  /// A stdio user server as the details route answers it, every contract field included.
  static let stdioJSON = """
    {"serverId":"notes","name":"notes","layer":"user","kind":"mcp-stdio","state":"required",
     "plugin":null,
     "stdio":{"command":"npx","resolvedCommand":"/opt/homebrew/bin/npx",
       "args":["-y","notes-mcp"],"cwd":"/Users/me","inheritEnv":false,
       "env":[{"key":"API_KEY","sensitive":true,"length":12,"risky":false},
              {"key":"NODE_OPTIONS","sensitive":true,"length":20,"risky":true}]},
     "http":null,"fingerprint":"\(fingerprint)"}
    """

  /// A plugin HTTP server whose URL and a header read service env vars, without a token.
  static let httpJSON = """
    {"serverId":"acme:search","name":"search","layer":"plugin","kind":"mcp-http-env",
     "state":"changed",
     "plugin":{"id":"acme","name":"Acme Tools","version":"1.2.0",
       "source":"npm acme-tools@1.2.0","revision":"r7"},
     "stdio":null,
     "http":{"url":"https://api.acme.dev/${REGION}/mcp","tokenEnv":"",
       "headerKeys":["X-Key","X-Trace"],"urlReadsEnv":true,
       "headers":[{"key":"X-Key","readsEnv":true},{"key":"X-Trace","readsEnv":false}],
       "envReferences":["ACME_KEY","REGION"]},
     "fingerprint":"\(fingerprint)"}
    """

  static func details(_ json: String) throws -> McpLaunchApprovalDetails {
    try JSONDecoder().decode(McpLaunchApprovalDetails.self, from: Data(json.utf8))
  }

  /// The catalog's source values in `language`, as the app bundle compiles them.
  static func text(_ language: ShellLanguage = .english) throws -> ShellText {
    let catalog = try ShellLocalizationTests.catalog()
    return ShellText(language: language) { key in
      catalog.strings[key.rawValue]?.localizations[language.rawValue]?.stringUnit.value ?? ""
    }
  }

  @Test("Details decode from the contract's JSON")
  func decodes() throws {
    let stdio = try Self.details(Self.stdioJSON)
    #expect(stdio.kind == .stdio && stdio.layer == .user && stdio.state == .required)
    #expect(stdio.plugin == nil && stdio.http == nil)
    #expect(
      stdio.stdio?.env == [
        .init(key: "API_KEY", length: 12, risky: false),
        .init(key: "NODE_OPTIONS", length: 20, risky: true),
      ])
    #expect(stdio.fingerprint == Self.fingerprint)
    let http = try Self.details(Self.httpJSON)
    #expect(http.kind == .httpEnv && http.layer == .plugin && http.state == .changed)
    #expect(http.plugin?.version == "1.2.0")
    #expect(http.http?.headers.map(\.readsEnv) == [true, false])
    #expect(throws: DecodingError.self) {
      try Self.details(Self.stdioJSON.replacingOccurrences(of: "mcp-stdio", with: "mcp-sse"))
    }
  }

  @Test("A stdio server lists its command with env keys masked and risky ones flagged")
  func stdioDialog() throws {
    let dialog = McpApprovalDialog(try Self.details(Self.stdioJSON), text: try Self.text())
    #expect(dialog.title == "Allow “notes” to run on this Mac?")
    #expect(dialog.message.hasPrefix("This local MCP server runs the command below"))
    #expect(
      dialog.detail == """
        Server: "notes"
        Type: User server
        Command: "npx"
        Runs: "/opt/homebrew/bin/npx"
        Arguments: ["-y", "notes-mcp"]
        Working directory: "/Users/me"
        Environment: Only the variables below
          "API_KEY" (hidden, 12 characters)
          "NODE_OPTIONS" (hidden, 20 characters) — Changes what runs
        """)
  }

  @Test("An HTTP server lists the env vars it sends; an empty tokenEnv is no token")
  func httpDialog() throws {
    let dialog = McpApprovalDialog(try Self.details(Self.httpJSON), text: try Self.text())
    #expect(dialog.title == "Allow “search” to run on this Mac?")
    #expect(dialog.message.hasPrefix("This MCP server sends the service values below to"))
    #expect(dialog.message.contains("https://api.acme.dev/${REGION}/mcp"))
    #expect(dialog.message.hasSuffix("It changed since you last allowed it."))
    #expect(
      dialog.detail == """
        Server: "acme:search"
        Type: Plugin server
        Plugin: "Acme Tools" "1.2.0"
        Source: "npm acme-tools@1.2.0"
        Revision: "r7"
        URL: "https://api.acme.dev/${REGION}/mcp" — Reads service env vars
        Headers:
          "X-Key" — Reads service env vars
          "X-Trace"
        Service env vars sent: "ACME_KEY", "REGION"
        """)
  }

  @Test("A bearer token's env var is listed and sent first")
  func tokenEnv() throws {
    let json = Self.httpJSON.replacingOccurrences(
      of: #""tokenEnv":"""#, with: #""tokenEnv":"GH_TOKEN""#)
    let detail = McpApprovalDialog(try Self.details(json), text: try Self.text()).detail
    #expect(detail.contains("\nBearer token from: \"GH_TOKEN\"\n"))
    #expect(detail.hasSuffix("Service env vars sent: \"GH_TOKEN\", \"ACME_KEY\", \"REGION\""))
  }

  @Test("A plugin's command names the plugin in the message")
  func pluginStdio() throws {
    let json = Self.stdioJSON.replacingOccurrences(
      of: #""plugin":null"#,
      with:
        #""plugin":{"id":"acme","name":"Acme","version":null,"source":"local /p","revision":""}"#
    ).replacingOccurrences(of: #""layer":"user""#, with: #""layer":"plugin""#)
    let dialog = McpApprovalDialog(try Self.details(json), text: try Self.text())
    #expect(dialog.message.hasPrefix("The plugin “Acme” (local /p) wants to run the command below"))
    #expect(dialog.detail.contains("\nPlugin: \"Acme\"\nSource: \"local /p\"\n"))
  }

  @Test("Configured values cannot break lines or hide characters")
  func quoting() throws {
    let json = Self.stdioJSON
      .replacingOccurrences(of: #""name":"notes""#, with: #""name":"no\ntes\u202Egpj.sh""#)
      .replacingOccurrences(of: #""-y""#, with: #""a\"b\\c\td""#)
    let dialog = McpApprovalDialog(try Self.details(json), text: try Self.text())
    #expect(dialog.title == "Allow “no tesgpj.sh” to run on this Mac?")
    #expect(dialog.detail.contains(#"Arguments: ["a\"b\\c\td", "notes-mcp"]"#))
    #expect(McpApprovalDialog.quoted("x\u{202E}y\u{2028}") == #""x\u202Ey\u2028""#)
    let long = String(repeating: "n", count: 300)
    #expect(McpApprovalDialog.inline(long).count == McpApprovalDialog.inlineLimit)
  }

  @Test("The dialog reads in Chinese")
  func chinese() throws {
    let dialog = McpApprovalDialog(
      try Self.details(Self.stdioJSON), text: try Self.text(.simplifiedChinese))
    #expect(dialog.title == "允许“notes”在这台 Mac 上运行吗？")
    #expect(dialog.detail.contains("命令：\"npx\""))
    #expect(dialog.detail.contains("\"API_KEY\" （已隐藏，12 个字符）"))
    #expect(dialog.detail.contains("— 会改变实际运行的内容"))
  }

  @Test("The approve request echoes the shown fingerprint, via the shell")
  func approveRequest() throws {
    let details = try Self.details(Self.httpJSON)
    let request = McpLaunchApproveRequest(approving: details)
    let object = try JSONSerialization.jsonObject(with: JSONEncoder().encode(request))
    #expect(
      object as? [String: String]
        == ["serverId": "acme:search", "fingerprint": Self.fingerprint, "via": "shell"])
  }

  @Test("Only 409 approval_changed means changed")
  func refusals() {
    #expect(McpLaunchApproveOutcome.refusal(status: 409, code: "approval_changed") == .changed)
    #expect(McpLaunchApproveOutcome.refusal(status: 409, code: "conflict") == nil)
    #expect(McpLaunchApproveOutcome.refusal(status: 400, code: "approval_changed") == nil)
    #expect(McpLaunchApproveOutcome.refusal(status: 409, code: nil) == nil)
  }
}
