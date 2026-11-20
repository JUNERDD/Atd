import Foundation
import Testing

@testable import AICore

@Suite("DiagnosticsScrubber Security & Performance Regressions (B3, B4, B5)", .serialized)
struct DiagnosticsScrubberSecurityTests {
  private static var testAnchors: DiagnosticsScrubber.EnvironmentAnchors {
    DiagnosticsScrubber.EnvironmentAnchors(
      homePaths: ["/Users/" + "alicecorp"],
      tmpPaths: ["/private/var/folders/ab/cd1234/T"],
      usernames: ["alicecorp", "Älice Müller"],
      hostnames: ["corpbox"])
  }

  @Test("B4: Sanitizes URLs before XML/HTML angle brackets and pre-scrubbed file://<user> URLs")
  func urlAngleBracketsAndPreScrubbedFileURLs() {
    let figmaKey = String(repeating: "AbCdEf", count: 4)
    let raw = """
      xml=<Location>https://private.corp.internal/v1/keys?X-Amz-Signature=secret123</Location>
      html=<a href="x">https://www.figma.com/design/\(figmaKey)/PrivateSpec?node-id=1-2</a>
      br=https://admin:pass@intranet.local/api<br>
      nodeFile1=file:///Users/<user>/Desktop/Confidential.pdf?preview=1
      nodeFile2=file:///home/<user>/secret.txt
      nodeLog=file:///Users/<user>/Library/Logs/AI/shell.log
      homeLog=file:///home/<user>/Library/Logs/AI/shell.log
      nonAsciiUser=hello Älice Müller from corpbox
      """

    let (clean, hits) = DiagnosticsScrubber.scrubText(raw, anchors: Self.testAnchors)
    #expect(hits >= 7)
    #expect(
      clean.contains("<Location>https://<redacted-host>/v1/<redacted-path>?<redacted></Location>"))
    #expect(!clean.contains("private.corp.internal"))
    #expect(!clean.contains("secret123"))

    #expect(clean.contains(#"<a href="x">https://figma.com/design/<redacted-figma-file></a>"#))
    #expect(!clean.contains(figmaKey))
    #expect(!clean.contains("PrivateSpec"))

    #expect(clean.contains("br=https://<redacted>@<redacted-host>/<redacted-path><br>"))
    #expect(!clean.contains("admin:pass"))
    #expect(!clean.contains("intranet.local"))

    #expect(clean.contains("nodeFile1=file:///Users/<user>/<redacted-file>"))
    #expect(!clean.contains("Confidential.pdf"))
    #expect(clean.contains("nodeFile2=file:///Users/<user>/<redacted-file>"))
    #expect(!clean.contains("secret.txt"))
    #expect(clean.contains("nodeLog=file:///Users/<user>/Library/Logs/AI/shell.log"))
    #expect(clean.contains("homeLog=file:///Users/<user>/Library/Logs/AI/shell.log"))
    #expect(clean.contains("nonAsciiUser=hello <user> from <host>"))

    // Verify full idempotency on a second pass (`0` additional redaction hits, identical output).
    let (secondPass, secondHits) = DiagnosticsScrubber.scrubText(clean, anchors: Self.testAnchors)
    #expect(secondPass == clean)
    #expect(secondHits == 0)
  }

  @Test("B5: Redacts multi-cookies, backslash-escaped secrets, paired quotes, & compound JSON keys")
  func multiCookiesBackslashesSingleQuotesAndCompoundKeys() throws {
    let rawText = #"""
      Cookie: sid=first_val; __Host-session=second_secret_val
      Set-Cookie: auth=first; refresh=second_secret; Path=/; HttpOnly
      escapedHdr="{\"hdr\":\"Cookie: sid=first_val; __Host-session=second_secret_val\"}"
      payload="{\"cookie\":\"sid=first_val; __Host-session=second_secret_val\"}"
      winPass=password="my\secret\pass123"
      escQuotes=password="quote\"inside\"secret"
      singleLine=token='short_tok' user='alice' msg='error'
      singleEsc=api_key='it\'s_secret' next='keep_me'
      usage=inputTokens=12345 outputTokens=6789 totalTokens=19134 maxTokens=32000 tokenCount=500
      """#

    let (clean, _) = DiagnosticsScrubber.scrubText(rawText, anchors: Self.testAnchors)
    #expect(clean.contains("Cookie: <redacted>"))
    #expect(clean.contains("Set-Cookie: <redacted>"))
    #expect(clean.contains(#"escapedHdr="{\"hdr\":\"Cookie: <redacted>\"}""#))
    #expect(clean.contains(#"payload="{\"cookie\":\"<redacted>\"}""#))
    #expect(!clean.contains("first_val"))
    #expect(!clean.contains("second_secret_val"))
    #expect(!clean.contains("second_secret"))

    #expect(clean.contains(#"winPass=password="<redacted>""#))
    #expect(!clean.contains(#"my\secret\pass123"#))
    #expect(clean.contains(#"escQuotes=password="<redacted>""#))
    #expect(!clean.contains("inside"))

    #expect(clean.contains("singleLine=token='<redacted>' user='alice' msg='error'"))
    #expect(clean.contains("singleEsc=api_key='<redacted>' next='keep_me'"))
    #expect(
      clean.contains(
        "usage=inputTokens=12345 outputTokens=6789 totalTokens=19134 maxTokens=32000 tokenCount=500"
      ))

    // Compound JSON secret keys vs preserved LLM token counters & diagnostic metadata flags.
    let secretKeys = [
      "private_key", "privateKey", "authToken", "sessionToken", "accessToken", "refreshToken",
      "idToken", "bearerToken", "csrfToken", "apiKey", "clientSecret", "webhookSecret",
      "signingSecret", "appSecret", "proxyPassword", "openai_api_key", "user_auth_token",
      "my_session_token", "svc_access_token", "svc_refresh_token", "jwt_secret", "db_password",
      "ldap_passwd", "ssh_private_key", "aws_credentials", "session_id", "sessionId",
    ]
    let safeIntKeys = [
      "inputTokens", "outputTokens", "totalTokens", "maxTokens", "cacheReadTokens", "tokenCount",
      "providerCredentialIssueCount", "envKeyCount", "headerKeyCount",
    ]
    var jsonPayload: [String: Any] = [
      "hasCredential": true,
      "credentialIssue": "credential_unreadable",
      "launchApprovalKeyState": "ready",
      "SUPublicEDKey": "ZkMCOa3sWdgMqszOe6hWN78I1eh77SzbSaghs2iy6lU=",
    ]
    for k in secretKeys { jsonPayload[k] = "plain_val_for_\(k)" }
    for k in safeIntKeys { jsonPayload[k] = 42 }

    let rawJson = try JSONSerialization.data(withJSONObject: jsonPayload)
    guard
      case .included(let scrubbedBytes, _, let hits, _) = DiagnosticsScrubber.scrubFile(
        path: "service-snapshot.json", rawBytes: rawJson, kind: .json, anchors: Self.testAnchors)
    else {
      Issue.record("Expected JSON payload with compound secret keys to be included")
      return
    }
    #expect(hits == secretKeys.count)
    let decoded = try #require(
      JSONSerialization.jsonObject(with: scrubbedBytes) as? [String: Any])
    for k in secretKeys {
      #expect(decoded[k] as? String == "<redacted>", "Expected secret key \(k) redacted")
    }
    for k in safeIntKeys {
      #expect(decoded[k] as? Int == 42, "Expected usage/count key \(k) preserved")
    }
    #expect(decoded["hasCredential"] as? Bool == true)
    #expect(decoded["credentialIssue"] as? String == "credential_unreadable")
    #expect(decoded["launchApprovalKeyState"] as? String == "ready")
    #expect(decoded["SUPublicEDKey"] as? String == "ZkMCOa3sWdgMqszOe6hWN78I1eh77SzbSaghs2iy6lU=")

    // Verify linear O(N) non-backtracking behavior on unclosed quotes & long hyphenated tokens. The
    // fastest of a few runs is compared, so load from suites running in parallel cannot fail it.
    let unclosed = #"password=""# + String(repeating: #"a\b"#, count: 1_200)
    let hyphens = String(repeating: "ab-", count: 1_300) + "=1234"
    var fastest = Duration.seconds(1)
    for _ in 0..<5 {
      let start = ContinuousClock.now
      _ = DiagnosticsScrubber.scrubText(unclosed + "\n" + hyphens, anchors: Self.testAnchors)
      fastest = min(fastest, start.duration(to: ContinuousClock.now))
    }
    #expect(fastest < .milliseconds(50))
  }

  @Test("B3: Scrubs 1 MiB (8,128-line) JSONL tail and 500-line snapshot within 250ms budget")
  func largeJsonlAndSnapshotStayWithinBudget() throws {
    // 1) Build an 8,128-line (~1.0 MiB) realistic JSONL log tail with occasional secrets/paths.
    var jsonl = Data()
    jsonl.reserveCapacity(1_048_576)
    for idx in 0..<8_128 {
      let msg: String
      if idx % 512 == 0 {
        msg = "connect https://alicecorp@intranet.local/v1/ping?k=1 from /Users/alicecorp/app"
      } else {
        msg = "shell flight recorder event seq=\(idx) window=settings state=ready"
      }
      let line =
        #"{"ts":"2026-11-18T14:31:10.123Z","level":"info","cat":"lifecycle","msg":"\#(msg)"}"#
        + "\n"
      jsonl.append(contentsOf: line.utf8)
    }

    let jsonlOutcome = DiagnosticsScrubber.scrubFile(
      path: "logs/shell.tail.jsonl",
      rawBytes: jsonl,
      kind: .jsonl,
      anchors: Self.testAnchors,
      budget: .milliseconds(250))
    guard case .included(let cleanJsonl, _, let jsonlHits, _) = jsonlOutcome else {
      Issue.record("Expected 8,128-line JSONL tail to finish within 250ms, got \(jsonlOutcome)")
      return
    }
    #expect(jsonlHits >= 16)
    #expect(!String(decoding: cleanJsonl, as: UTF8.self).contains("intranet.local"))

    // 2) Build a 500-line `service-snapshot.json` (~440 KiB) with embedded JSON ring lines.
    let ringLines: [String] = (0..<500).map { idx in
      let padding = String(repeating: "x", count: 720)
      return
        #"{"ts":"2026-11-18T14:31:10.123Z","level":"info","cat":"http","msg":"req \#(idx) \#(padding)"}"#
    }
    let snapshotObj: [String: Any] = [
      "schemaVersion": 1,
      "capturedAt": "2026-11-18T14:31:10.123Z",
      "boundedLogRing": [
        "capacity": 500,
        "droppedCount": 0,
        "byteLength": 420_000,
        "lines": ringLines,
      ],
    ]
    let rawSnapshot = try JSONSerialization.data(withJSONObject: snapshotObj)
    #expect(rawSnapshot.count >= 400_000)

    let snapOutcome = DiagnosticsScrubber.scrubFile(
      path: "service-snapshot.json",
      rawBytes: rawSnapshot,
      kind: .json,
      anchors: Self.testAnchors,
      budget: .milliseconds(250))
    guard case .included(let cleanSnap, _, _, _) = snapOutcome else {
      Issue.record("Expected 500-line service-snapshot.json to finish within 250ms: \(snapOutcome)")
      return
    }
    #expect(!cleanSnap.isEmpty)

    // 3) JSON `\uXXXX` and `\/` escapes in JSONL never bypass Pass A/B/C/D or secret key matching.
    let escapedLines =
      #"{"ts":"2026-11-18T14:31:10.123Z","level":"info","msg":"mail jane.doe\u0040corp-example.com"}"#
      + "\n"
      + #"{"ts":"2026-11-18T14:31:10.123Z","level":"info","msg":"url https\u003a\u002f\u002fprivate.corp.internal\u002fv1\u002fkeys?sig=secret999"}"#
      + "\n"
      + #"{"ts":"2026-11-18T14:31:10.123Z","api\u005fkey":"unicode_escaped_secret_key_val","slashUrl":"https:\/\/intranet.local\/admin"}"#
      + "\n"
    guard
      case .included(let cleanEscapedBytes, _, let escapedHits, _) = DiagnosticsScrubber.scrubFile(
        path: "logs/service.tail.jsonl",
        rawBytes: Data(escapedLines.utf8),
        kind: .jsonl,
        anchors: Self.testAnchors)
    else {
      Issue.record("Expected JSONL with unicode/slash escapes to be scrubbed and included")
      return
    }
    #expect(escapedHits == 4)
    let cleanEscapedText = String(decoding: cleanEscapedBytes, as: UTF8.self)
    #expect(!cleanEscapedText.contains("jane.doe"))
    #expect(!cleanEscapedText.contains("private.corp.internal"))
    #expect(!cleanEscapedText.contains("secret999"))
    #expect(!cleanEscapedText.contains("unicode_escaped_secret_key_val"))
    #expect(!cleanEscapedText.contains("intranet.local"))
    let escapedOutLines = cleanEscapedText.split(separator: "\n")
    #expect(escapedOutLines.count == 3)
    let row0 = try #require(
      JSONSerialization.jsonObject(with: Data(escapedOutLines[0].utf8)) as? [String: Any])
    let row1 = try #require(
      JSONSerialization.jsonObject(with: Data(escapedOutLines[1].utf8)) as? [String: Any])
    let row2 = try #require(
      JSONSerialization.jsonObject(with: Data(escapedOutLines[2].utf8)) as? [String: Any])
    #expect(row0["msg"] as? String == "mail <redacted:email>")
    #expect(row1["msg"] as? String == "url https://<redacted-host>/v1/<redacted-path>?<redacted>")
    #expect(row2["api_key"] as? String == "<redacted>")
    #expect(row2["slashUrl"] as? String == "https://<redacted-host>/<redacted-path>")
  }
}
