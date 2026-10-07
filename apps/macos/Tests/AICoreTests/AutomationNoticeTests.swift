import Foundation
import Testing

@testable import AICore

@Suite("Automation notices and their notifications")
struct AutomationNoticeTests {
  /// A notice with every contract member, as `GET /v1/automation-notices` lists it.
  static let fullJSON = """
    {"id":"ntc_1","kind":"needsAttention","automationId":"auto_1","automationName":"Inbox sweep",
     "taskId":"task_1","summary":"Sorted 12 messages.","declined":2,
     "createdAt":"2026-10-06T08:00:00.000Z"}
    """

  static let longName = "\"automationName\":\"\(String(repeating: "x", count: 121))\""
  static let longSummary = "\"summary\":\"\(String(repeating: "x", count: 501))\""

  static func decode(_ json: String) throws -> AutomationNotice {
    try JSONDecoder().decode(AutomationNotice.self, from: Data(json.utf8))
  }

  static func notice(
    _ kind: AutomationNotice.Kind, name: String = "Inbox sweep", summary: String? = nil,
    declined: Int? = nil
  ) -> AutomationNotice {
    AutomationNotice(
      id: "ntc_1", kind: kind, automationId: "auto_1", automationName: name, taskId: "task_1",
      summary: summary, declined: declined, createdAt: "2026-10-06T08:00:00.000Z")
  }

  static func notification(_ notice: AutomationNotice, _ language: ShellLanguage = .english)
    throws -> AutomationNotification
  {
    AutomationNotification(notice, text: try McpApprovalDialogTests.text(language))
  }

  @Test("Decodes notices as the contract writes them, optional members absent or present")
  func decodes() throws {
    #expect(
      try Self.decode(Self.fullJSON)
        == Self.notice(.needsAttention, summary: "Sorted 12 messages.", declined: 2))
    let minimal = try Self.decode(
      #"{"id":"n","kind":"paused","automationId":"a","automationName":"x","createdAt":"t"}"#)
    #expect(minimal.kind == .paused && minimal.taskId == nil)
    #expect(minimal.summary == nil && minimal.declined == nil)
    let response = try JSONDecoder().decode(
      AutomationNoticesResponse.self, from: Data(#"{"notices":[\#(Self.fullJSON)]}"#.utf8))
    #expect(response.notices.map(\.id) == ["ntc_1"])
  }

  @Test(
    "Refuses a notice outside the contract",
    arguments: [
      (#""kind":"needsAttention""#, #""kind":"cancelled""#),
      (#""id":"ntc_1""#, #""id":"ntc 1""#),
      (#""taskId":"task_1""#, #""taskId":null"#),
      (#""automationName":"Inbox sweep""#, #""automationName":"""#),
      (#""automationName":"Inbox sweep""#, longName),
      (#""summary":"Sorted 12 messages.""#, longSummary),
      (#""declined":2"#, #""declined":-1"#),
      (#""declined":2"#, #""declined":1.5"#),
      (#""declined":2"#, #""declined":2,"extra":true"#),
      (#""createdAt""#, #""created""#),
    ])
  func refuses(member: String, replacement: String) {
    #expect(throws: DecodingError.self) {
      try Self.decode(Self.fullJSON.replacingOccurrences(of: member, with: replacement))
    }
  }

  @Test("Refuses a response with more notices than the service keeps")
  func refusesTooMany() {
    let notices = Array(repeating: Self.fullJSON, count: AutomationNotice.maxPending + 1)
    let json = #"{"notices":[\#(notices.joined(separator: ","))]}"#
    #expect(throws: DecodingError.self) {
      try JSONDecoder().decode(AutomationNoticesResponse.self, from: Data(json.utf8))
    }
  }

  @Test(
    "Words each kind in English around the name and summary",
    arguments: [
      (notice(.delivered, summary: "Sorted 12 messages."), "Inbox sweep", "Sorted 12 messages."),
      (notice(.delivered), "Inbox sweep", "Finished — open to see the result."),
      (notice(.delivered, summary: " \n "), "Inbox sweep", "Finished — open to see the result."),
      (
        notice(.needsAttention, summary: "Sorted 12 messages.", declined: 1),
        "“Inbox sweep” needs your attention",
        "1 action or question was declined because no one was there.\nSorted 12 messages."
      ),
      (
        notice(.needsAttention, declined: 3), "“Inbox sweep” needs your attention",
        "3 actions or questions were declined because no one was there."
      ),
      (
        notice(.needsAttention), "“Inbox sweep” needs your attention",
        "Some actions or questions were declined because no one was there."
      ),
      (
        notice(.failed, summary: "The model is not available."), "“Inbox sweep” didn’t finish",
        "The model is not available."
      ),
      (
        notice(.failed), "“Inbox sweep” didn’t finish",
        "Something went wrong before it could finish."
      ),
      (
        notice(.paused, summary: "Timed out."), "“Inbox sweep” was turned off",
        "It failed several times in a row. You can turn it back on in Settings › Automations."
      ),
    ])
  func english(notice: AutomationNotice, title: String, body: String) throws {
    let notification = try Self.notification(notice)
    #expect(notification.title == title)
    #expect(notification.body == body)
  }

  @Test(
    "Words each kind in Simplified Chinese, leaving runtime data as written",
    arguments: [
      (notice(.delivered), "Inbox sweep", "已完成，打开即可查看结果。"),
      (
        notice(.needsAttention, summary: "Sorted 12 messages.", declined: 2), "“Inbox sweep”需要你处理",
        "由于无人在场，已拒绝 2 项操作或提问。\nSorted 12 messages."
      ),
      (notice(.failed), "“Inbox sweep”未能完成", "运行在完成前出了问题。"),
      (notice(.paused), "“Inbox sweep”已关闭", "它连续多次运行失败。你可以在“设置 › 自动化”中重新开启。"),
    ])
  func chinese(notice: AutomationNotice, title: String, body: String) throws {
    let notification = try Self.notification(notice, .simplifiedChinese)
    #expect(notification.title == title)
    #expect(notification.body == body)
  }

  @Test("Names and summaries are never read as format strings")
  func runtimeDataVerbatim() throws {
    let notice = Self.notice(.failed, name: "100% %@ done", summary: "%lld left")
    let notification = try Self.notification(notice)
    #expect(notification.title == "“100% %@ done” didn’t finish")
    #expect(notification.body == "%lld left")
  }

  @Test("Carries what posting and opening need")
  func identity() throws {
    let notification = try Self.notification(Self.notice(.delivered))
    #expect(notification.identifier == "ntc_1")
    #expect(notification.threadIdentifier == "auto_1")
    #expect(notification.taskId == "task_1")
  }
}
