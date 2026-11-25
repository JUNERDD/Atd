import AICore
import Foundation

/// A run the shell starts for Atd for Chrome: the person's text with the page it came from, run
/// in their own Chrome (`computer.browser: 'chrome'`) with the site's binding when they allowed
/// the site (D12).
public nonisolated struct ChromeTaskSubmit: Sendable {
  public let operationId: String
  public let text: String
  public let selection: String
  /// The site binding when the person allowed the site; empty starts the run with no site yet.
  public let bindingIds: [String]
  /// Whether the run may use the person's Chrome at all (asks and commands that act on the page).
  public let usesChrome: Bool
  /// The task a follow-up message continues; nil starts a new task.
  public let taskId: String?

  public init(
    operationId: String, text: String, selection: String, bindingIds: [String], usesChrome: Bool,
    taskId: String? = nil
  ) {
    self.operationId = operationId
    self.text = text
    self.selection = selection
    self.bindingIds = bindingIds
    self.usesChrome = usesChrome
    self.taskId = taskId
  }
}

/// A started run (`SubmitTaskResponseSchema`, also what a command run answers).
public nonisolated struct StartedRun: Decodable, Equatable, Sendable {
  public let taskId: String
  public let runId: String
}

/// The members of `ServiceCommandSchema` the extension's selection toolbar needs.
public nonisolated struct SelectionCommand: Decodable, Equatable, Sendable {
  public struct Input: Decodable, Equatable, Sendable {
    public let source: String
    public let selection: Bool
  }

  public struct Placement: Decodable, Equatable, Sendable {
    public let selectionToolbar: Bool
  }

  public let id: String
  public let name: String
  public let enabled: Bool
  public let input: Input
  public let placement: Placement
  public let lastArguments: [String: JSONValue]?

  /// `offeredAt(command, 'selectionToolbar')` of `@atd/agent-contracts` (command-placement.ts).
  public var offeredAtSelectionToolbar: Bool {
    enabled && placement.selectionToolbar && (input.source == "selection" || input.selection)
  }
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

  /// `POST /v1/commands/:id/run`: runs the person's command on the selection, its answer kept in
  /// the conversation (`panel`), where the extension's result reads it.
  public func runSelectionCommand(
    _ command: SelectionCommand, selection: String, operationId: String
  ) async throws -> StartedRun {
    let submit = ChromeTaskSubmit(
      operationId: operationId, text: "", selection: selection, bindingIds: [], usesChrome: false)
    var input = Self.input(submit)
    if case .object(var members) = input {
      members["arguments"] = .object(command.lastArguments ?? [:])
      input = .object(members)
    }
    let body: JSONValue = .object([
      "operationId": .string(operationId), "input": input,
      "output": .object(["action": .string("panel"), "review": .bool(false)]),
    ])
    let path = "/v1/commands/\(RelayPath.encodeSegment(command.id))/run"
    return try JSONDecoder().decode(StartedRun.self, from: try await post(path, body).data)
  }

  /// `GET /v1/commands`: the person's commands and the plugins'.
  public func selectionCommands() async throws -> [SelectionCommand] {
    struct List: Decodable { let commands: [SelectionCommand] }
    return try JSONDecoder().decode(List.self, from: try await send("GET", "/v1/commands").data)
      .commands
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

  /// `TaskInputSchema` for text typed in Chrome, with the page's selection.
  private static func input(_ submit: ChromeTaskSubmit) -> JSONValue {
    .object([
      "text": .string(submit.text),
      "source": .string(submit.selection.isEmpty ? "manual" : "selection"),
      "capturedAt": .string(ComputerWireCoding.timestamp(Date())),
      "selection": .string(submit.selection), "clipboard": .string(""), "files": .array([]),
      "arguments": .object([:]), "chips": .array([]), "folders": .array([]),
    ])
  }
}
