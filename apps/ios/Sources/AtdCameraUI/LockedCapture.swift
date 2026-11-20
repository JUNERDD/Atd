import Foundation
import ImageIO
import UniformTypeIdentifiers

/// What the Lock Screen capture extension leaves for the app in its session's content
/// directory: the mode and option the person chose, and the photo's file beside it. The record
/// is written after the photo, so a folder whose record reads is complete.
public nonisolated struct LockedCaptureRecord: Codable, Sendable, Equatable {
  public var modeID: String?
  /// The mode's option value chosen for this shot, by option key.
  public var values: [String: String]
  public var capturedAt: Date
  /// The photo's file name in the same folder; nil when the person chose 从照片选, which the
  /// app opens after unlocking.
  public var photo: String?

  public init(
    modeID: String?, values: [String: String], capturedAt: Date, photo: String? = nil
  ) {
    self.modeID = modeID
    self.values = values
    self.capturedAt = capturedAt
    self.photo = photo
  }

  /// The person asked to pick a photo from the library instead of taking one.
  public var wantsLibrary: Bool { photo == nil }
}

/// A complete capture found in a session folder.
public nonisolated struct LockedCapture: Sendable, Equatable {
  public var folder: URL
  public var record: LockedCaptureRecord
  /// Nil when the record asks for the library.
  public var photo: Data?
}

/// Reads and writes captures in a session's content directory with plain file IO; one capture
/// per session, a later shot replacing an earlier one.
public nonisolated enum LockedCaptureFolder {
  static let recordName = "capture.json"

  /// Writes `photo`, then `record` naming it, into `folder`.
  public static func write(_ record: LockedCaptureRecord, photo: Data?, into folder: URL) throws {
    var record = record
    try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
    if let photo {
      let name = "capture." + fileExtension(of: photo)
      try photo.write(to: folder.appending(path: name), options: .atomic)
      record.photo = name
    } else {
      record.photo = nil
    }
    let data = try JSONEncoder().encode(record)
    try data.write(to: folder.appending(path: recordName), options: .atomic)
  }

  /// The capture in `folder`; nil while it is incomplete or unreadable.
  public static func read(_ folder: URL) -> LockedCapture? {
    guard let data = try? Data(contentsOf: folder.appending(path: recordName)),
      let record = try? JSONDecoder().decode(LockedCaptureRecord.self, from: data)
    else { return nil }
    guard let name = record.photo else {
      return LockedCapture(folder: folder, record: record, photo: nil)
    }
    guard let photo = try? Data(contentsOf: folder.appending(path: name)) else { return nil }
    return LockedCapture(folder: folder, record: record, photo: photo)
  }

  /// heic or jpg, as the camera encoded it.
  private static func fileExtension(of photo: Data) -> String {
    guard let source = CGImageSourceCreateWithData(photo as CFData, nil),
      let identifier = CGImageSourceGetType(source) as String?,
      let type = UTType(identifier), let fileExtension = type.preferredFilenameExtension
    else { return "jpg" }
    return fileExtension
  }
}
