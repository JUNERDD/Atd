import AtdAI
import AtdModel
import Foundation
import ImageIO
import Observation
import UniformTypeIdentifiers

/// One 问 Atd conversation: questions with their photos, answers streamed in, and the photos
/// waiting to go with the next question. It lives only as long as the panel; nothing is saved,
/// except the commands made from its answers (存为指令), which go to the library.
@Observable
final class AskConversation {
  struct Turn: Identifiable {
    let id = UUID()
    let question: String
    let photos: [ModelImage]
    var answer = ""
    var state = State.thinking
    /// The command this answer was saved as.
    var saved: SavedCommand?
  }

  /// A command made from an answer, as it was named when it was saved.
  struct SavedCommand: Equatable {
    let id: String
    let name: String
  }

  enum State: Equatable {
    case thinking, streaming, done, stopped
    case failed(ModelFailure)
  }

  private(set) var turns: [Turn] = []
  /// Photos to send with the next question, in the order they were added.
  var photos: [ModelImage] = []
  @ObservationIgnored private var answering: Task<Void, Never>?

  /// At most this many photos go with one question.
  static let photoLimit = 4

  var isAnswering: Bool {
    guard let state = turns.last?.state else { return false }
    return state == .thinking || state == .streaming
  }

  func ask(
    _ question: String, runner: some TextGenerating, onFailure: @escaping (ModelFailure) -> Void
  ) {
    let question = question.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !question.isEmpty, !isAnswering else { return }
    turns.append(Turn(question: question, photos: photos))
    photos = []
    answer(runner: runner, onFailure: onFailure)
  }

  /// Asks the last question again after a failure.
  func retry(runner: some TextGenerating, onFailure: @escaping (ModelFailure) -> Void) {
    guard let last = turns.indices.last, !isAnswering else { return }
    turns[last].answer = ""
    turns[last].state = .thinking
    answer(runner: runner, onFailure: onFailure)
  }

  func stop() {
    answering?.cancel()
    answering = nil
    if let last = turns.indices.last, isAnswering { turns[last].state = .stopped }
  }

  /// 新对话: clears the panel.
  func reset() {
    stop()
    turns = []
    photos = []
  }

  /// Notes that the answer of turn `id` was saved as `command`, so the turn says so.
  func markSaved(_ id: UUID, as command: Command) {
    guard let index = turns.firstIndex(where: { $0.id == id }) else { return }
    turns[index].saved = SavedCommand(id: command.id, name: command.displayName)
  }

  private func answer(runner: some TextGenerating, onFailure: @escaping (ModelFailure) -> Void) {
    guard let index = turns.indices.last else { return }
    let turn = turns[index]
    // Earlier exchanges that ended with an answer give the model the conversation so far.
    let earlier = turns[..<index].filter { $0.state == .done }.map {
      AskPrompt.Exchange(question: $0.question, images: $0.photos, answer: $0.answer)
    }
    let request = AskPrompt.request(turn.question, images: turn.photos, after: earlier)
    let id = turn.id
    answering = Task {
      do {
        for try await delta in runner.stream(request, choice: .appDefault) {
          update(id) {
            $0.answer += delta
            $0.state = .streaming
          }
        }
        update(id) {
          $0.state = $0.answer.isEmpty ? .failed(.unreadable(detail: nil)) : .done
        }
      } catch let failure as ModelFailure {
        update(id) { $0.state = .failed(failure) }
        onFailure(failure)
      } catch {
        // Stopped; `stop()` already marked the turn.
      }
    }
  }

  /// Changes the turn `id` while it is still waiting for its answer, so a stopped turn keeps
  /// what it had.
  private func update(_ id: UUID, _ change: (inout Turn) -> Void) {
    guard let index = turns.firstIndex(where: { $0.id == id }),
      turns[index].state == .thinking || turns[index].state == .streaming
    else { return }
    change(&turns[index])
  }
}

/// Prepares a photo for a model: at most 1568 pixels on the long side, upright, as JPEG. Runs off
/// the main actor; full-size photos take a moment to decode.
nonisolated enum PhotoEncoder {
  static let maxPixels = 1568

  @concurrent
  static func encode(_ data: Data) async -> ModelImage? {
    guard let source = CGImageSourceCreateWithData(data as CFData, nil) else { return nil }
    let options: [CFString: Any] = [
      kCGImageSourceCreateThumbnailFromImageAlways: true,
      kCGImageSourceCreateThumbnailWithTransform: true,
      kCGImageSourceThumbnailMaxPixelSize: maxPixels,
    ]
    guard let image = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary)
    else { return nil }
    let output = NSMutableData()
    guard
      let destination = CGImageDestinationCreateWithData(
        output, UTType.jpeg.identifier as CFString, 1, nil)
    else { return nil }
    CGImageDestinationAddImage(
      destination, image, [kCGImageDestinationLossyCompressionQuality: 0.8] as CFDictionary)
    guard CGImageDestinationFinalize(destination) else { return nil }
    return ModelImage(data: output as Data, mediaType: "image/jpeg")
  }
}
