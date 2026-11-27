import AICore
import Foundation

/// A run the shell starts for Atd for Chrome: the person's text and the page it came from, run
/// in their own Chrome (`computer.browser: 'chrome'`) with the site's binding when they allowed
/// the site (D12).
public nonisolated struct ChromeTaskSubmit: Sendable {
  /// `AskedPageSchema`: the page an ask came from and the elements the person picked on it, which
  /// the service tells the run apart from `text`, so the task's title and the person's message in
  /// the conversation stay what they typed.
  public struct Page: Equatable, Sendable {
    public struct Element: Equatable, Sendable {
      public let label: String
      public let selector: String
      public let text: String

      public init(label: String, selector: String, text: String) {
        self.label = label
        self.selector = selector
        self.text = text
      }
    }

    public let title: String
    public let url: String
    public let elements: [Element]

    public init(title: String, url: String, elements: [Element]) {
      self.title = title
      self.url = url
      self.elements = elements
    }
  }

  public let operationId: String
  /// What the person typed.
  public let text: String
  /// The page an ask came from; nil for an ask whose page the person removed, and for Save as
  /// automation.
  public let page: Page?
  /// The site binding when the person allowed the site; empty starts the run with no site yet.
  public let bindingIds: [String]
  /// Whether the run may use the person's Chrome at all (an ask does, also one that continues a
  /// task; Save as automation does not).
  public let usesChrome: Bool
  /// The task the run continues (an ask's conversation, or Save as automation); nil starts a new
  /// task.
  public let taskId: String?

  public init(
    operationId: String, text: String, page: Page? = nil, bindingIds: [String],
    usesChrome: Bool, taskId: String? = nil
  ) {
    self.operationId = operationId
    self.text = text
    self.page = page
    self.bindingIds = bindingIds
    self.usesChrome = usesChrome
    self.taskId = taskId
  }
}

/// A started run (`SubmitTaskResponseSchema`).
public nonisolated struct StartedRun: Decodable, Equatable, Sendable {
  public let taskId: String
  public let runId: String
}

extension ShellClient {
  /// `POST /v1/tasks`: starts a task for the extension, or a run of `taskId` for a follow-up.
  public func submitChromeTask(_ submit: ChromeTaskSubmit) async throws -> StartedRun {
    var body: [String: JSONValue] = [
      "operationId": .string(submit.operationId), "input": Self.input(submit),
    ]
    if let taskId = submit.taskId { body["taskId"] = .string(taskId) }
    if let page = submit.page { body["page"] = Self.page(page) }
    if submit.usesChrome {
      body["computer"] = .object([
        "bindingIds": .array(submit.bindingIds.map(JSONValue.string)), "browser": .string("chrome"),
      ])
    }
    return try JSONDecoder().decode(
      StartedRun.self, from: try await post("/v1/tasks", .object(body)).data)
  }

  /// `POST /v1/tasks/:taskId/queue`: a follow-up message for the task's active run.
  public func queueFollowUp(taskId: String, text: String) async throws {
    let body: JSONValue = .object(["text": .string(text), "mode": .string("followUp")])
    _ = try await post("/v1/tasks/\(RelayPath.encodeSegment(taskId))/queue", body)
  }

  /// The final answer `runId` gave, from the task snapshot's last settled assistant block of that
  /// run; nil when it has none.
  public func runAnswer(taskId: String, runId: String) async throws -> String? {
    struct Snapshot: Decodable {
      struct Body: Decodable {
        struct Block: Decodable {
          let kind: String
          let runId: String
          let text: String?
          let streaming: Bool?
        }
        let blocks: [Block]
      }
      let snapshot: Body
    }
    let path = "/v1/tasks/\(RelayPath.encodeSegment(taskId))/snapshot"
    let blocks = try JSONDecoder().decode(Snapshot.self, from: try await send("GET", path).data)
      .snapshot.blocks
    return blocks.last {
      $0.kind == "assistant" && $0.runId == runId && $0.streaming != true
        && !($0.text ?? "").isEmpty
    }?.text
  }

  /// `POST /v1/computer/chrome-sites`, shell only: the person turned the site's switch on in Atd
  /// for Chrome. Idempotent; answers the site's persistent binding.
  public func saveChromeSite(installationId: String, origin: String) async throws
    -> TargetBindingWire
  {
    struct Saved: Decodable { let binding: TargetBindingWire }
    let body: JSONValue = .object([
      "installationId": .string(installationId), "origin": .string(origin),
    ])
    return try JSONDecoder().decode(
      Saved.self, from: try await post("/v1/computer/chrome-sites", body).data
    ).binding
  }

  /// `DELETE /v1/computer/bindings/:id`: removes a binding and revokes what used it.
  public func deleteComputerBinding(id: String) async throws {
    _ = try await send("DELETE", "/v1/computer/bindings/\(RelayPath.encodeSegment(id))")
  }

  private func post(_ path: String, _ body: JSONValue) async throws -> Response {
    try await send(
      "POST", path, body: try JSONEncoder().encode(body), contentType: "application/json",
      timeout: 15)
  }

  private static func page(_ page: ChromeTaskSubmit.Page) -> JSONValue {
    .object([
      "title": .string(page.title), "url": .string(page.url),
      "elements": .array(
        page.elements.map {
          .object([
            "label": .string($0.label), "selector": .string($0.selector), "text": .string($0.text),
          ])
        }),
    ])
  }

  /// `TaskInputSchema` for text typed in Chrome.
  private static func input(_ submit: ChromeTaskSubmit) -> JSONValue {
    .object([
      "text": .string(submit.text), "source": .string("manual"),
      "capturedAt": .string(ComputerWireCoding.timestamp(Date())),
      "selection": .string(""), "clipboard": .string(""), "files": .array([]),
      "arguments": .object([:]), "chips": .array([]), "folders": .array([]),
    ])
  }
}
