import AtdAI
import AtdModel
import Foundation

/// The requests 新建小应用 and 改一改 send. Only what the run needs leaves the phone: a build
/// sends the person's sentence; a refinement sends the app's page, its fields and widget, its
/// lists' records and its other fields' values, never its daily history or the expense ledger.
/// Both carry the hand-drawn-style skill, so every page is drawn in Atd's hand.
public enum MiniAppPrompt {
  /// A new app from the person's sentence.
  /// - Parameter language: the language the app's words are written in (`zh-Hans`, `en`).
  public static func build(_ description: String, language: String) -> ModelRequest {
    ModelRequest(
      system: system("MiniAppPromptBuild", language: language)
        + "\n\nSYMBOLS\n\nThe symbol is one of these SF Symbols names: "
        + "\(StickerSymbols.promptList).",
      messages: [ModelMessage(.user, description)])
  }

  /// The app changed the way `request` asks.
  public static func refine(
    _ request: String, app: MiniApp, package: MiniAppPackage, data: MiniAppData,
    language: String
  ) -> ModelRequest {
    let fields = MiniAppJSON.parse(
      (try? JSONEncoder().encode(package.manifest.schema.fields)) ?? Data())
    var values: [String: MiniAppJSON] = [:]
    for field in package.manifest.schema.fields where field.kind != .daily {
      let value = data.values[field.name] ?? .null
      if field.kind == .list, case .array(let records) = value {
        // The newest records, enough to edit by id; the rest stay on the phone.
        values[field.name] = .array(Array(records.suffix(50)))
      } else {
        values[field.name] = value
      }
    }
    let current = """
      The app now:
      name: \(app.name)
      fields: \((fields ?? .array([])).jsonString)
      values: \(MiniAppJSON.object(values).jsonString)
      widget: \(package.manifest.widget.json.jsonString)
      page:
      \(package.page)

      The change the person asks for:
      \(request)
      """
    return ModelRequest(
      system: system("MiniAppPromptRefine", language: language),
      messages: [ModelMessage(.user, current)])
  }

  /// What 修复 asks for: the page's own error, fixed. The model writes the summary the person
  /// sees in their language.
  public static func fixRequest(_ error: String) -> String {
    "The page stopped with this error: \(error.prefix(600))\nFix the page so that it cannot "
      + "happen again, and keep everything else as it is."
  }

  /// Asks once more for only the section that could not be used, after `answer`.
  public static func repair(
    _ original: ModelRequest, answer: String, section: MiniAppAnswer.Section, reason: String
  ) -> ModelRequest {
    var request = original
    request.messages.append(ModelMessage(.assistant, answer))
    request.messages.append(
      ModelMessage(
        .user,
        "The [[\(section.rawValue)]] section cannot be used: \(reason). Answer with only a "
          + "corrected [[\(section.rawValue)]] section, then [[END]]."))
    return request
  }

  private static func system(_ prompt: String, language: String) -> String {
    let name =
      Locale(identifier: "en_US").localizedString(forIdentifier: language) ?? language
    return [
      text(prompt), text("MiniAppPromptReference"), "STYLE\n\n" + skill("hand-drawn-style"),
      "LANGUAGE\n\nWrite every word the person sees (the name, the ABOUT lines, the ideas, the "
        + "page and the widget's labels) in \(name).",
    ].joined(separator: "\n\n")
  }

  /// The instructions of the skill in `Skills/<name>/SKILL.md`, after its front matter. A run is
  /// one request that cannot load a skill itself, so the system prompt carries it whole.
  private static func skill(_ name: String) -> String {
    guard
      let url = Bundle.module.url(
        forResource: "SKILL", withExtension: "md", subdirectory: "Skills/\(name)"),
      let file = try? String(contentsOf: url, encoding: .utf8), file.hasPrefix("---\n"),
      let end = file.range(of: "\n---\n")
    else {
      // The skills ship in this module's bundle; without them the build itself is broken.
      fatalError("the \(name) skill is missing from the app")
    }
    return file[end.upperBound...].trimmingCharacters(in: .whitespacesAndNewlines)
  }

  private static func text(_ name: String) -> String {
    guard let url = Bundle.module.url(forResource: name, withExtension: "txt"),
      let text = try? String(contentsOf: url, encoding: .utf8)
    else {
      // The prompts ship in this module's bundle; without them the build itself is broken.
      fatalError("\(name).txt is missing from the app")
    }
    return text.trimmingCharacters(in: .whitespacesAndNewlines)
  }
}
