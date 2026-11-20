#if canImport(VisualIntelligence)
  import AppIntents
  import AtdCameraUI
  import AtdModel
  import CoreImage
  import Foundation
  import ImageIO
  import VisualIntelligence

  /// Visual Intelligence (device only, with Apple Intelligence; absent from the simulator SDK):
  /// for what the person is looking at, Atd offers its camera modes as results, the one the
  /// labels suggest first. Tapping one opens the camera in that mode with the frame
  /// (`OpenCameraLensIntent`); 更多结果 opens it in the mode used last (`CameraLensSearchIntent`).
  /// Visual Intelligence draws the results itself; Atd adds no buttons or text to it.
  nonisolated struct CameraLensEntity: AppEntity {
    static let typeDisplayRepresentation = TypeDisplayRepresentation(
      name: LocalizedStringResource("lens.type", table: "CameraIntents"))
    static let defaultQuery = CameraLensEntityQuery()

    /// `<frame>/<mode id>`: the saved frame (`CameraLensFrames`) and the camera mode.
    let id: String
    let name: String
    let symbol: String

    var displayRepresentation: DisplayRepresentation {
      DisplayRepresentation(
        title: "\(name)", image: DisplayRepresentation.Image(systemName: symbol))
    }

    var frame: String { String(id.prefix { $0 != "/" }) }
    var modeID: String { String(id.drop { $0 != "/" }.dropFirst()) }
  }

  /// Finds offered modes again by id, for `OpenCameraLensIntent`.
  nonisolated struct CameraLensEntityQuery: EntityQuery {
    func entities(for identifiers: [String]) async throws -> [CameraLensEntity] {
      let modes = CameraLens.modes()
      return identifiers.compactMap { id in
        let entity = CameraLensEntity(id: id, name: "", symbol: "")
        guard let mode = modes.first(where: { $0.id == entity.modeID }) else { return nil }
        return CameraLensEntity(id: id, name: mode.name, symbol: mode.symbol)
      }
    }
  }

  /// What Visual Intelligence asks Atd for: the frame is kept for the camera, and up to four
  /// camera modes come back.
  nonisolated struct CameraLensQuery: IntentValueQuery {
    func values(for input: SemanticContentDescriptor) async throws -> [CameraLensEntity] {
      guard let frame = CameraLensFrames.save(input) else { return [] }
      let modes = CameraLens.ordered(CameraLens.modes(), labels: input.labels)
      return modes.prefix(4).map { mode in
        CameraLensEntity(id: "\(frame)/\(mode.id)", name: mode.name, symbol: mode.symbol)
      }
    }
  }

  /// Opens the camera in an offered mode and runs it on the frame it was offered for.
  struct OpenCameraLensIntent: OpenIntent {
    static let title = LocalizedStringResource("lens.open", table: "CameraIntents")

    @Parameter(title: LocalizedStringResource("lens.mode", table: "CameraIntents"))
    var target: CameraLensEntity

    init() {}

    @MainActor
    func perform() async throws -> some IntentResult {
      if let photo = CameraLensFrames.photo(target.frame) { CameraInbox.shared.hand(photo) }
      RouteCenter.shared.open(.camera(commandID: target.modeID))
      return .result()
    }
  }

  /// 更多结果: the camera opens with the frame, in the mode used last.
  @AppIntent(schema: .visualIntelligence.semanticContentSearch)
  struct CameraLensSearchIntent: AppIntent {
    var semanticContent: SemanticContentDescriptor

    @MainActor
    func perform() async throws -> some IntentResult {
      if let frame = CameraLensFrames.save(semanticContent),
        let photo = CameraLensFrames.photo(frame)
      {
        CameraInbox.shared.hand(photo)
      }
      RouteCenter.shared.open(.camera(commandID: nil))
      return .result()
    }
  }

  /// The library's camera modes, and their order for what Visual Intelligence saw.
  nonisolated enum CameraLens {
    static func modes() -> [CameraMode] {
      guard let group = AppGroup.current(), let store = SharedStore.appGroup(group) else {
        return []
      }
      return CameraMode.modes(in: store.load(CommandLibrary.self).document)
    }

    /// `modes` with the built-in one the labels (English words) point to first: a receipt for
    /// 记一笔, a poster or flyer for 提取日程, a whiteboard for 整理白板, and 翻译 for anything else.
    static func ordered(_ modes: [CameraMode], labels: [String]) -> [CameraMode] {
      let words = Set(
        labels.flatMap { $0.lowercased().split { !$0.isLetter }.map(String.init) })
      let hints: [(id: String, words: Set<String>)] = [
        (BuiltinCommands.expenseID, ["receipt", "invoice", "bill"]),
        (BuiltinCommands.eventID, ["poster", "flyer", "ticket", "invitation"]),
        (BuiltinCommands.whiteboardID, ["whiteboard", "blackboard", "chalkboard"]),
      ]
      let first =
        hints.first { !$0.words.isDisjoint(with: words) }?.id ?? BuiltinCommands.translateID
      return modes.filter { $0.id == first } + modes.filter { $0.id != first }
    }
  }

  /// Frames Visual Intelligence showed, as JPEGs in Caches until the camera takes one; only the
  /// newest few stay.
  nonisolated enum CameraLensFrames {
    private static let keep = 4
    /// The long side frames are kept at, as the camera reads photos (`CameraReader.maxPixels`).
    private static let maxPixels: CGFloat = 2560

    private static var folder: URL {
      URL.cachesDirectory.appending(path: "visual", directoryHint: .isDirectory)
    }

    /// Saves the descriptor's frame; its name, or nil when there is none.
    static func save(_ content: SemanticContentDescriptor) -> String? {
      guard let buffer = content.pixelBuffer,
        let data = buffer.withUnsafeBuffer({ jpeg(CIImage(cvPixelBuffer: $0)) })
      else { return nil }
      let name = UUID().uuidString
      do {
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        try data.write(to: folder.appending(path: name + ".jpg"), options: .atomic)
      } catch {
        return nil
      }
      prune()
      return name
    }

    /// A saved frame; only names `save` gave are read.
    static func photo(_ name: String) -> Data? {
      guard UUID(uuidString: name) != nil else { return nil }
      return try? Data(contentsOf: folder.appending(path: name + ".jpg"))
    }

    private static func jpeg(_ image: CIImage) -> Data? {
      let scale = min(1, maxPixels / max(image.extent.width, image.extent.height, 1))
      let scaled = image.transformed(by: CGAffineTransform(scaleX: scale, y: scale))
      guard let space = CGColorSpace(name: CGColorSpace.sRGB) else { return nil }
      return CIContext().jpegRepresentation(
        of: scaled, colorSpace: space,
        options: [
          CIImageRepresentationOption(
            rawValue: kCGImageDestinationLossyCompressionQuality as String): 0.85
        ])
    }

    private static func prune() {
      let manager = FileManager.default
      guard
        let files = try? manager.contentsOfDirectory(
          at: folder, includingPropertiesForKeys: [.creationDateKey])
      else { return }
      let dated = files.map { file in
        (file, (try? file.resourceValues(forKeys: [.creationDateKey]).creationDate) ?? .distantPast)
      }
      for (file, _) in dated.sorted(by: { $0.1 > $1.1 }).dropFirst(keep) {
        try? manager.removeItem(at: file)
      }
    }
  }
#endif
