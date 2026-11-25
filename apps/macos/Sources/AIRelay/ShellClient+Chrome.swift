import AICore
import Foundation

/// A run the shell starts for Atd for Chrome: the person's text with the page it came from, run
/// in their own Chrome (`computer.browser: 'chrome'`) with the site's binding when they allowed
/// the site (D12).
public nonisolated struct ChromeTaskSubmit: Sendable {
  public let operationId: String
  public let text: String
  /// The site binding when the person allowed the site; empty starts the run with no site yet.
  public let bindingIds: [String]
  /// Whether the run may use the person's Chrome at all (an ask does; a follow-up from the HUD
  /// does not).
  public let usesChrome: Bool
  /// The task a follow-up message continues; nil starts a new task.
  public let taskId: String?

  public init(
    operationId: String, text: String, bindingIds: [String], usesChrome: Bool,
    taskId: String? = nil
  ) {
    self.operationId = operationId
    self.text = text
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
