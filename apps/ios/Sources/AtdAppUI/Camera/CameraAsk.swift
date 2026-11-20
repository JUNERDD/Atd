import AtdAI
import SwiftUI

/// What 问 Atd is opened about from a camera result: its title for the chip, the text the
/// questions are about (a translation, a card as text) and the photo sized for a model.
struct CameraAskTopic: Identifiable {
  var title: String
  var text: String?
  var photo: ModelImage?
  var symbol: String

  var id: String { title }
}

enum CameraAsk {
  /// 问 Atd about `topic`: the panel opens with the result as its context, so the first question
  /// carries the photo and the text.
  static func sheet(about topic: CameraAskTopic) -> some View {
    AskSheet(
      context: AskContext(
        title: topic.title, text: topic.text, photo: topic.photo, symbol: topic.symbol))
  }
}
