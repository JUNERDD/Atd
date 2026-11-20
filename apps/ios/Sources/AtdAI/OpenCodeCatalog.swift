import AtdModel
import Foundation

extension ProviderPreset {
  public var isOpenCode: Bool { id == "opencode" || id == "opencode-go" }

  /// OpenCode publishes each chat model's preferred API and effort levels in its own catalog.
  /// Construct routes from the preset, so discovery can never redirect the person's key.
  public func openCodeURL(for api: ProviderAPI) -> URL? {
    guard isOpenCode, let baseURL else { return nil }
    if api == .anthropic {
      return baseURL.deletingLastPathComponent().deletingLastPathComponent().appending(
        path: "anthropic")
    }
    return baseURL
  }

  public func openCodeModels(key: String, session: URLSession = .models) async throws -> [ModelInfo]
  {
    guard isOpenCode, let baseURL else { throw ModelFailure.noModel }
    let root = baseURL.deletingLastPathComponent().deletingLastPathComponent()
    var request = URLRequest(url: root.appending(path: "v1/models"))
    request.setValue("Bearer \(key)", forHTTPHeaderField: "Authorization")
    let list = try await HTTPStream.json(
      request, session: session, as: OpenCodeList.self,
      failure: OpenAIAnswerDecoder.failure)
    return list.data.filter { $0.type == "chat" }.map(\.info)
  }
}

private struct OpenCodeList: Decodable {
  struct Entry: Decodable {
    struct Capabilities: Decodable {
      struct Reasoning: Decodable { var effort: [String]? }
      var reasoning: Reasoning?
    }
    let id: String
    let name: String?
    let type: String
    let recommendedApi: String?
    let capabilities: Capabilities?

    var info: ModelInfo {
      // OpenCode also translates its other text models (including Gemini) through Responses.
      let api: ProviderAPI =
        switch recommendedApi {
        case "messages": .anthropic
        case "chat-completions": .openAICompatible
        default: .openAIResponses
        }
      let efforts = (capabilities?.reasoning?.effort ?? []).compactMap(
        ReasoningEffort.init(rawValue:))
      return ModelInfo(id: id, name: name, api: api, efforts: efforts)
    }
  }
  let data: [Entry]
}

extension URLRequest {
  mutating func identifyOpenCodeSession(_ conversation: UUID?) {
    guard url?.host() == "opencode.ai" else { return }
    setValue(
      "Atd-iOS/\(Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "dev")",
      forHTTPHeaderField: "User-Agent")
    setValue((conversation ?? UUID()).uuidString, forHTTPHeaderField: "x-opencode-session")
  }
}
