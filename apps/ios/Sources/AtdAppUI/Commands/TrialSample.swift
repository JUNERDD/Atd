import AtdAI
import AtdModel
import UIKit

/// What a trial run starts from, so a built-in command can be tried with one tap: a message for
/// one that reads text, and a photo drawn here for one that reads a photo (a café receipt for
/// 记一笔, a whiteboard for 整理白板). 今日简报 reads today's agenda instead, and commands the
/// person made start empty.
enum TrialSample {
  static func text(for command: Command) -> String {
    switch command.id {
    case BuiltinCommands.polishID: AppText.string("sample.polish")
    case BuiltinCommands.replyID: AppText.string("sample.reply")
    case BuiltinCommands.translateID: AppText.string("sample.translate")
    case BuiltinCommands.shortenID: AppText.string("sample.shorten")
    case BuiltinCommands.eventID: AppText.string("sample.event")
    default: ""
    }
  }

  /// The sample photo of a built-in command that reads one, prepared as any photo a model gets;
  /// nil for every other command.
  static func photo(for command: Command) async -> ModelImage? {
    let picture: UIImage? =
      switch command.id {
      case BuiltinCommands.expenseID: receipt()
      case BuiltinCommands.whiteboardID: whiteboard()
      default: nil
      }
    guard let data = picture?.pngData() else { return nil }
    return await ImageEncoding.modelImage(from: data)
  }

  /// A café receipt with today's date under the shop's name, cut where its last line ends so
  /// its text stays legible in the trial's preview.
  private static func receipt() -> UIImage {
    var lines = AppText.string("sample.receipt").components(separatedBy: "\n")
    let date = Date.now.formatted(
      .dateTime.year().month(.twoDigits).day(.twoDigits).hour().minute())
    lines.insert(date, at: min(1, lines.count))
    let heading = UIFont.monospacedSystemFont(ofSize: 52, weight: .bold)
    let body = UIFont.monospacedSystemFont(ofSize: 40, weight: .regular)
    let text = heading.lineHeight * 1.8 + body.lineHeight * 1.5 * CGFloat(lines.count - 1)
    return draw(
      lines, size: CGSize(width: 640, height: (2 * margin + text).rounded(.up)), paper: .white,
      ink: UIColor(white: 0.15, alpha: 1), heading: heading, body: body)
  }

  /// A meeting room whiteboard in blue marker.
  private static func whiteboard() -> UIImage {
    draw(
      AppText.string("sample.whiteboard").components(separatedBy: "\n"),
      size: CGSize(width: 1280, height: 860), paper: UIColor(white: 0.95, alpha: 1),
      ink: UIColor(red: 0.12, green: 0.26, blue: 0.62, alpha: 1),
      heading: .systemFont(ofSize: 66, weight: .heavy), body: .systemFont(ofSize: 46, weight: .bold)
    )
  }

  /// The space around a sample's lines.
  private static let margin: CGFloat = 64

  /// Lines top to bottom, the first as a heading; a tab in a line sets what follows it flush
  /// right, as a price is on a receipt.
  private static func draw(
    _ lines: [String], size: CGSize, paper: UIColor, ink: UIColor, heading: UIFont, body: UIFont
  ) -> UIImage {
    let format = UIGraphicsImageRendererFormat()
    format.scale = 1
    return UIGraphicsImageRenderer(size: size, format: format).image { context in
      paper.setFill()
      context.fill(CGRect(origin: .zero, size: size))
      var top = margin
      for (index, line) in lines.enumerated() {
        let font = index == 0 ? heading : body
        let attributes: [NSAttributedString.Key: Any] = [.font: font, .foregroundColor: ink]
        let parts = line.components(separatedBy: "\t")
        (parts[0] as NSString).draw(at: CGPoint(x: margin, y: top), withAttributes: attributes)
        if parts.count > 1 {
          let right = parts[1] as NSString
          let width = right.size(withAttributes: attributes).width
          right.draw(
            at: CGPoint(x: size.width - margin - width, y: top), withAttributes: attributes)
        }
        top += font.lineHeight * (index == 0 ? 1.8 : 1.5)
      }
    }
  }
}
