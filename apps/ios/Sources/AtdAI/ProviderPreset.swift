import AtdModel
import Foundation

/// A provider the 添加模型 page offers: its protocol and address, so a connection needs only a
/// key and a model. Presets are data; supporting another compatible provider is one more entry.
/// Models are listed through the protocol's own endpoint, and every preset also accepts a model
/// id typed in.
public struct ProviderPreset: Sendable, Identifiable, Equatable {
  /// The preset whose address the person enters: any OpenAI-compatible endpoint.
  public static let customID = "custom"

  public var id: String
  public var name: String
  public var api: ProviderAPI
  /// Where requests go; nil for the custom preset.
  public var baseURL: URL?
  /// The model a new connection starts with when the provider lists it.
  public var suggestedModel: String?

  public static func all() -> [ProviderPreset] {
    [
      ProviderPreset(
        id: "openai", name: "OpenAI", api: .openAIResponses,
        baseURL: url("https://api.openai.com/v1")),
      ProviderPreset(
        id: "anthropic", name: "Anthropic", api: .anthropic,
        baseURL: url("https://api.anthropic.com"), suggestedModel: "claude-opus-5-5"),
      ProviderPreset(
        id: "gemini", name: "Gemini", api: .openAICompatible,
        baseURL: url("https://generativelanguage.googleapis.com/v1beta/openai")),
      ProviderPreset(
        id: "deepseek", name: "DeepSeek", api: .openAICompatible,
        baseURL: url("https://api.deepseek.com")),
      ProviderPreset(
        id: "openrouter", name: "OpenRouter", api: .openAICompatible,
        baseURL: url("https://openrouter.ai/api/v1")),
      ProviderPreset(
        id: "qwen", name: String(localized: "preset.qwen", bundle: .module),
        api: .openAICompatible,
        baseURL: url("https://dashscope-intl.aliyuncs.com/compatible-mode/v1")),
      ProviderPreset(
        id: "opencode-go", name: "OpenCode Go", api: .openAIResponses,
        baseURL: url("https://opencode.ai/inference/go/openai/v1")),
      ProviderPreset(
        id: "opencode", name: "OpenCode", api: .openAIResponses,
        baseURL: url("https://opencode.ai/inference/openai/v1")),
      ProviderPreset(
        id: "xai", name: "xAI", api: .openAIResponses,
        baseURL: url("https://api.x.ai/v1")),
      ProviderPreset(
        id: "groq", name: "Groq", api: .openAICompatible,
        baseURL: url("https://api.groq.com/openai/v1")),
      ProviderPreset(
        id: "cerebras", name: "Cerebras", api: .openAICompatible,
        baseURL: url("https://api.cerebras.ai/v1")),
      ProviderPreset(
        id: "moonshotai", name: "Moonshot AI", api: .openAICompatible,
        baseURL: url("https://api.moonshot.ai/v1")),
      ProviderPreset(
        id: "zai", name: "Z.AI Coding Plan", api: .openAICompatible,
        baseURL: url("https://api.z.ai/api/coding/paas/v4")),
      ProviderPreset(
        id: "minimax", name: "MiniMax", api: .anthropic,
        baseURL: url("https://api.minimax.io/anthropic")),
      ProviderPreset(
        id: "together", name: "Together AI", api: .openAICompatible,
        baseURL: url("https://api.together.ai/v1")),
      ProviderPreset(
        id: customID, name: String(localized: "preset.custom", bundle: .module),
        api: .openAICompatible, baseURL: nil),
    ]
  }

  public static func preset(_ id: String) -> ProviderPreset? {
    all().first { $0.id == id }
  }

  private static func url(_ string: StaticString) -> URL {
    guard let url = URL(string: "\(string)") else { preconditionFailure("bad preset URL") }
    return url
  }
}
