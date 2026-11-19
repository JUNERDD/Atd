import Foundation
import Testing

@testable import AICore

@Suite("DiagnosticsScrubber 5-Pass Pipeline and ServiceUnavailableDescriptor")
struct DiagnosticsScrubberTests {
  private static var testAnchors: DiagnosticsScrubber.EnvironmentAnchors {
    DiagnosticsScrubber.EnvironmentAnchors(
      homePaths: ["/Users/" + "alicecorp"],
      tmpPaths: ["/private/var/folders/ab/cd1234/T"],
      usernames: ["alicecorp"],
      hostnames: ["corpbox"])
  }

  @Test("Pass C runs strictly before Pass A/B so host/user anchors never split URL redaction")
  func passCPrecedesPassAAndB() {
    let figmaUrl =
      "https://www.figma.com/" + "design/" + String(repeating: "Ab9", count: 7)
      + "/Spec?node-id=1-2"
    let figmaAsset = "https://www.figma.com/api/" + "mcp/asset/998877-abcdef"
    let cfId = String(repeating: "a1b2", count: 8)
    let input = """
      privateUrl=https://corpbox.internal.acme.io:8443/v1/customers/alicecorp?code=oauth999#sec
      presigned=https://bob:s3cr3t@assets.atd.best/pkg/Atd.dmg?X-Amz-Signature=deadbeef
      publicOk=https://api.openai.com/v1/models
      figma1=\(figmaUrl)
      figma2=\(figmaAsset)
      cf1=https://dash.cloudflare.com/\(cfId)
      cf2=account_id="\(cfId)"
      localDoc=file:///Users/\("alicecorp")/Desktop/Payroll2026.xlsx?preview=1
      localLog=file:///Users/\("alicecorp")/Library/Logs/AI/shell.log
      """

    let (scrubbed, hits) = DiagnosticsScrubber.scrubText(input, anchors: Self.testAnchors)
    #expect(hits >= 8)
    #expect(
      scrubbed.contains(
        "privateUrl=https://<redacted-host>/v1/<redacted-path>?<redacted>#<redacted>"))
    #expect(!scrubbed.contains("oauth999"))
    #expect(!scrubbed.contains("acme.io"))
    #expect(
      scrubbed.contains("presigned=https://<redacted>@assets.atd.best/pkg/Atd.dmg?<redacted>"))
    #expect(!scrubbed.contains("deadbeef"))
    #expect(scrubbed.contains("publicOk=https://api.openai.com/v1/models"))
    #expect(scrubbed.contains("figma1=https://figma.com/design/<redacted-figma-file>"))
    #expect(scrubbed.contains("figma2=https://figma.com/api/mcp/asset/<redacted-figma-asset>"))
    #expect(scrubbed.contains("cf1=https://dash.cloudflare.com/<redacted-account-id>"))
    #expect(scrubbed.contains(#"cf2=account_id="<redacted-account-id>""#))
    #expect(scrubbed.contains("localDoc=file:///Users/<user>/<redacted-file>"))
    #expect(!scrubbed.contains("Payroll2026"))
    #expect(scrubbed.contains("localLog=file:///Users/<user>/Library/Logs/AI/shell.log"))
  }

  @Test("Preserves backslash escapes, public SUPublicEDKey, npm scopes, UUIDs, and SHA-256 digests")
  func escapesTokensAndAllowlists() {
    let openaiKey = ["sk", "proj", String(repeating: "Zx8w", count: 6)].joined(separator: "-")
    let awsKey = "AKIA" + String(repeating: "ABCD", count: 4)
    let jwt = [
      "eyJhbGciOiJIUzI1NiJ9",
      "eyJzdWIiOiIxMjM0NTY3ODkwIn0",
      "SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c",
    ].joined(separator: ".")
    let pemHeader = "-----BEGIN " + "PRIVATE KEY-----"
    let pemFooter = "-----END " + "PRIVATE KEY-----"
    let publicEdKey = "SUPublicEDKey: " + String(repeating: "AbCd", count: 10) + "EfG="

    let raw = """
      escaped="{\\"apiKey\\":\\"my_plain_secret_99\\",\\"url\\":\\"https://intranet.local/secret?k=1\\"}"
      auth=Authorization: Bearer super_secret_bearer_token_123
      ws=ai.auth.session_tok_987654
      keys=\(openaiKey) \(awsKey) \(jwt)
      mail=jane.doe@corp-example.com pkg=@atd/agent-service@1.0.0
      uuid=550e8400-e29b-41d4-a716-446655440000
      sha=e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
      \(publicEdKey)
      \(pemHeader)
      MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC7
      \(pemFooter)
      after_pem=ok
      """

    let (clean, _) = DiagnosticsScrubber.scrubText(raw, anchors: Self.testAnchors)
    // Backslash escapes before quotes must remain intact (`\"`, never eaten to `"`).
    #expect(clean.contains(#"\"apiKey\":\"<redacted>\""#))
    #expect(clean.contains(#"\"url\":\"https://<redacted-host>/<redacted-path>?<redacted>\""#))
    #expect(clean.contains("Bearer <redacted-token>"))
    #expect(clean.contains("ai.auth.<redacted-token>"))
    #expect(!clean.contains(openaiKey))
    #expect(!clean.contains(awsKey))
    #expect(!clean.contains("SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c"))
    #expect(clean.contains("mail=<redacted:email>"))
    #expect(clean.contains("pkg=@atd/agent-service@1.0.0"))
    #expect(clean.contains("550e8400-e29b-41d4-a716-446655440000"))
    #expect(clean.contains("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"))
    #expect(clean.contains(publicEdKey))
    #expect(clean.contains("-----REDACTED PEM BLOCK-----"))
    #expect(!clean.contains("MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC7"))
    #expect(clean.contains("after_pem=ok"))
  }

  @Test("JSON and JSONL scrubbers parse first, tolerate invalid UTF-8, cap 4KiB, and fail closed")
  func jsonJsonl4KiBCapAndFailClosed() throws {
    let userPath = "/Users/" + "alicecorp" + "/Library/Application Support/AgentService"
    let jsonObj: [String: Any] = [
      "ok": true,
      "count": 7,
      "access_token": "tok_should_be_redacted",
      "dataDir": userPath,
      "boundedLogRing": [
        "lines": [
          #"{"level":"info","msg":"started in \#(userPath)","token":"nested_tok"}"#
        ]
      ],
    ]
    let rawJson = try JSONSerialization.data(withJSONObject: jsonObj)
    let jsonOutcome = DiagnosticsScrubber.scrubFile(
      path: "service-snapshot.json", rawBytes: rawJson, kind: .json, anchors: Self.testAnchors)
    guard case .included(let cleanJsonBytes, _, let hits, _) = jsonOutcome else {
      Issue.record("Expected valid JSON to be included")
      return
    }
    #expect(hits >= 3)
    let reparsed = try #require(
      JSONSerialization.jsonObject(with: cleanJsonBytes) as? [String: Any])
    #expect(reparsed["ok"] as? Bool == true)
    #expect(reparsed["count"] as? Int == 7)
    #expect(reparsed["access_token"] as? String == "<redacted>")
    #expect((reparsed["dataDir"] as? String)?.hasPrefix("~/Library") == true)
    let nestedLine =
      ((reparsed["boundedLogRing"] as? [String: Any])?["lines"] as? [String])?.first ?? ""
    #expect(!nestedLine.contains("nested_tok"))
    #expect(!nestedLine.contains("alicecorp"))

    // Malformed JSON fails closed with zero bytes leaked.
    let badJson = DiagnosticsScrubber.scrubFile(
      path: "service-snapshot.json", rawBytes: Data("{broken".utf8), kind: .json)
    #expect(
      badJson
        == .omitted(status: .omittedRedactionError, errorCode: .utf8OrJsonInvalid, durationMs: 0)
        || {
          if case .omitted(.omittedRedactionError, .utf8OrJsonInvalid, _) = badJson { return true }
          return false
        }())

    // Expired CPU budget fails closed (`cpu_budget_exceeded`).
    let timedOut = DiagnosticsScrubber.scrubFile(
      path: "logs/shell.tail.jsonl", rawBytes: Data("{\"msg\":\"hi\"}\n".utf8),
      kind: .jsonl, budget: .zero)
    if case .omitted(let status, let code, _) = timedOut {
      #expect(status == .omittedRedactionError)
      #expect(code == .cpuBudgetExceeded)
    } else {
      Issue.record("Expected zero budget to trigger fail-closed omission")
    }

    // Overlong CJK line + stray 0xFF invalid UTF-8 byte in JSONL wraps into valid 4KiB JSON line.
    var rawJsonl = Data(#"{"level":"info","path":"\#(userPath)"}"#.utf8)
    rawJsonl.append(0x0A)
    rawJsonl.append(0xFF)
    rawJsonl.append(contentsOf: String(repeating: "漢", count: 1600).utf8)
    rawJsonl.append(0x0A)

    guard
      case .included(let jsonlBytes, _, _, _) = DiagnosticsScrubber.scrubFile(
        path: "logs/service.tail.jsonl", rawBytes: rawJsonl, kind: .jsonl, anchors: Self.testAnchors
      )
    else {
      Issue.record("Expected JSONL with stray byte and long line to succeed")
      return
    }
    let outLines = String(decoding: jsonlBytes, as: UTF8.self).split(separator: "\n")
    #expect(outLines.count == 2)
    for line in outLines {
      #expect((try? JSONSerialization.jsonObject(with: Data(line.utf8))) != nil)
    }
    let wrapped = try #require(
      JSONSerialization.jsonObject(with: Data(outLines[1].utf8)) as? [String: String])
    let preview = try #require(wrapped["raw_scrubbed"])
    #expect(preview.utf8.count <= 4_096)
    #expect(preview.hasSuffix("…[truncated:4KiB]"))
  }

  @Test("ServiceUnavailableDescriptor maps every ServiceUnavailable & ServiceEndpointError case")
  func serviceUnavailableDescriptorMapping() {
    let rawErr =
      "Error: EACCES open '/Users/" + "alicecorp" + "/Library/service.lock' "
      + String(repeating: "detail_", count: 40)
    let failed = ServiceUnavailableDescriptor.describe(.failed(rawErr), anchors: Self.testAnchors)
    #expect(failed.errorCode == "service_start_failed")
    #expect(failed.wsCloseCode == 1011)
    #expect(!failed.summary.contains("alicecorp"))
    #expect(failed.summary.utf8.count <= 170)
    #expect(failed.wsCloseReason.utf8.count <= 200)

    let breakerWithLast = ServiceUnavailableDescriptor.describe(
      .stoppedTooOften, lastFailure: rawErr, anchors: Self.testAnchors)
    #expect(breakerWithLast.errorCode == "service_stopped_too_often")
    #expect(breakerWithLast.wsCloseReason.utf8.count <= 200)
    #expect(!breakerWithLast.summary.contains("alicecorp"))

    let breakerDefault = ServiceUnavailableDescriptor.describe(.stoppedTooOften, lastFailure: nil)
    #expect(breakerDefault.summary.contains("paused automatic restarts"))

    #expect(ServiceUnavailableDescriptor.describe(.starting).wsCloseCode == 1013)
    #expect(ServiceUnavailableDescriptor.describe(.stopped).wsCloseCode == 1001)
    #expect(
      ServiceUnavailableDescriptor.describe(.developmentServiceNotRunning).errorCode
        == "service_not_running")

    let endpointCases: [(ServiceEndpointError, String)] = [
      (.notRunning, "not_running"),
      (.malformed("auth/token"), "malformed_token"),
      (.malformed("endpoint.json"), "malformed_endpoint"),
      (.notLoopback, "not_loopback"),
      (.unsupportedProtocol, "unsupported_protocol"),
      (.tokenMismatch, "token_mismatch"),
      (.stale, "stale_pid"),
    ]
    for (err, expectedCode) in endpointCases {
      let desc = ServiceUnavailableDescriptor.describe(.invalidEndpoint(err))
      #expect(desc.errorCode == "service_not_running")
      #expect(desc.summary == "Service endpoint unusable (\(expectedCode)).")
    }
  }
}
