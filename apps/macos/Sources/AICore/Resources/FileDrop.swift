import Foundation

/// What a file drag over the panel carries, read once when it enters: the panel page tells the
/// user what a drop would attach before the items are imported.
public struct FileDragSummary: Equatable, Sendable {
  /// Every dragged file and folder.
  public let files: Int
  /// What a drop's import (``ImportBatch``) would take: its files of an attachable format, and
  /// its folders. The service still applies its size rule and its folder rules.
  public let attachable: Int

  public init(items: [ImportItem]) {
    files = items.count
    let batch = ImportBatch(items)
    attachable = batch.files.filter(AttachmentRules.isAttachable).count + batch.folders.count
  }
}

extension AttachmentRules {
  /// Whether a dropped URL names a file of an attachable format; a folder never is.
  public static func isAttachable(_ url: URL) -> Bool {
    !url.hasDirectoryPath && extensions.contains(url.pathExtension.lowercased())
  }
}

/// The panel's drop phase (`files.drag`): a drag over the panel shows what it carries; once
/// files are dropped, the phase stays `importing` until every drop's import has answered, so the
/// page keeps its feedback until the chips arrive or the failures are reported.
public struct FileDropState: Equatable, Sendable {
  public private(set) var drag: FileDragSummary?
  private var imports = 0

  public init() {}

  public var event: FilesDragEvent {
    if let drag {
      return FilesDragEvent(phase: .over, files: drag.files, attachable: drag.attachable)
    }
    return FilesDragEvent(phase: imports > 0 ? .importing : .none, files: 0, attachable: 0)
  }

  /// A file drag entered the panel (a summary) or left it, dropped or not (nil).
  public mutating func setDrag(_ summary: FileDragSummary?) {
    drag = summary
  }

  public mutating func beginImport() {
    imports += 1
  }

  public mutating func endImport() {
    imports = max(0, imports - 1)
  }
}
