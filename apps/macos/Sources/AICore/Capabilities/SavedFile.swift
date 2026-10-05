import Foundation

/// A `files.save` request checked at the shell boundary, past what its schema states (the name's
/// and the content's lengths): the name the save panel suggests and the bytes it writes.
public struct SavedFile: Equatable, Sendable {
  /// The page's name reduced to a visible basename; a PNG always ends in `.png`.
  public let suggestedName: String
  public let bytes: Data
  /// The panel then allows only PNG, so the user cannot rename the image into another type.
  public let isPNG: Bool

  public enum Failure: Error, Equatable, Sendable {
    /// The PNG content is not base64, or its bytes do not start with the PNG signature.
    case invalidImage
  }

  /// The eight bytes every PNG file starts with.
  static let pngSignature = Data([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])

  public static func validate(_ params: FilesSaveParams) -> Result<SavedFile, Failure> {
    switch params.content {
    case .text(let text):
      return .success(
        SavedFile(
          suggestedName: name(params.name, fallback: "download.txt"),
          bytes: Data(text.text.utf8), isPNG: false))
    case .png(let png):
      guard let bytes = Data(base64Encoded: png.base64), bytes.starts(with: pngSignature) else {
        return .failure(.invalidImage)
      }
      var suggested = name(params.name, fallback: "download.png")
      if (suggested as NSString).pathExtension.lowercased() != "png" { suggested += ".png" }
      return .success(SavedFile(suggestedName: suggested, bytes: bytes, isPNG: true))
    }
  }

  /// The basename without leading dots, which would hide the file, or `fallback` when nothing
  /// is left.
  public static func name(_ requested: String, fallback: String) -> String {
    let base = AttachmentRules.basename(requested).trimmingCharacters(in: .whitespacesAndNewlines)
    let visible = String(base.drop { $0 == "." })
    return visible.isEmpty ? fallback : visible
  }
}
