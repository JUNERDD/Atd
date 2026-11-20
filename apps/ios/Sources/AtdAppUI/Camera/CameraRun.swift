import AtdAI
import AtdModel
import Foundation

/// What a camera run gives: 翻译's items, or a card with the marks it can show on the photo.
enum CameraAnswer: Equatable {
  case translation(CameraTranslation)
  case card(CardResult, marks: [CameraMark])
}

/// Why a run gave nothing, in the words the sheet shows.
struct CameraFailure: Equatable {
  var message: String
  /// 重试 runs the same photo again.
  var canRetry: Bool
  /// 添加模型 instead: no model is configured.
  var needsModel: Bool

  init(_ error: any Error) {
    switch error {
    case let failure as ModelFailure:
      message = failure.message
      canRetry = failure.canRetry
      needsModel = failure == .noModel
    case let failure as CardFailure:
      message = failure.message
      canRetry = false
      needsModel = false
    default:
      message = CameraCopy.string("camera.failed")
      canRetry = true
      needsModel = false
    }
  }
}

/// Runs a command on a read photo. 翻译 streams JSON Lines (`CameraTranslatePrompt`) and shows
/// items as they arrive; a card command answers once through `CardRunner`, asked for the lines
/// each part came from; any other command gives a text card.
enum CameraRun {
  static func run(
    _ command: Command, shot: CameraShot, image: ModelImage?, generator: any TextGenerating,
    progress: (CameraAnswer) -> Void
  ) async throws -> CameraAnswer {
    if command.id == BuiltinCommands.translateID {
      return try await .translation(
        translate(command, shot: shot, image: image, generator: generator) {
          progress(.translation($0))
        })
    }
    return try await card(command, shot: shot, image: image, generator: generator)
  }

  private static func translate(
    _ command: Command, shot: CameraShot, image: ModelImage?, generator: any TextGenerating,
    progress: (CameraTranslation) -> Void
  ) async throws -> CameraTranslation {
    let target = command.option(BuiltinCommands.OptionKey.language)?.value ?? ""
    let request = CameraTranslatePrompt.request(
      command, lines: shot.lines, image: image, target: target,
      currency: CardContext.regionCurrency)
    var reader = CameraTranslationReader(lineCount: shot.lines.count)
    for try await delta in generator.stream(request, choice: command.model) {
      // The sheet comes up with the first item: a title alone would show an empty card.
      if reader.feed(delta), !reader.translation.items.isEmpty { progress(reader.translation) }
    }
    // A cancelled stream may end quietly; half an answer is no translation.
    try Task.checkCancellation()
    return try reader.finish()
  }

  private static func card(
    _ command: Command, shot: CameraShot, image: ModelImage?, generator: any TextGenerating
  ) async throws -> CameraAnswer {
    let runner = CardRunner(generator: generator)
    let images = image.map { [$0] } ?? []
    let kind = command.output.cardKind
    guard let rule = CameraMarks.rule(for: kind) else {
      // A text card reads the photo's text as plain lines; it marks nothing.
      let text = shot.lines.map(\.text).joined(separator: "\n")
      let card = try await runner.run(command, input: CardInput(text: text, images: images))
      return .card(card, marks: [])
    }
    let input = CardInput(text: CameraText.listing(shot.lines), images: images)
    let (card, fields) = try await runner.run(
      command, input: input, asking: rule, reading: CameraMarkFields.self)
    return .card(card, marks: CameraMarks.marks(fields, for: card, lineCount: shot.lines.count))
  }
}

/// The camera's copy, in AtdAppUI's `Camera` table.
enum CameraCopy {
  static func string(_ key: String.LocalizationValue) -> String {
    String(localized: key, table: "Camera", bundle: .module)
  }
}
