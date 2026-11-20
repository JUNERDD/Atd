import AtdCameraUI
import AtdModel
import Foundation
import Testing

@Suite struct CameraContextTests {
  @Test func modesAreCameraCommandsThatTakeInputInLibraryOrder() {
    var library = CommandLibrary(commands: BuiltinCommands.all())
    // A command of the person's own reads the photo's text; one without input cannot run on a
    // photo, even with the camera switch on (A43).
    var reads = library.commands[0]
    reads.id = "reads"
    reads.placement.camera = true
    var inputless = reads
    inputless.id = "inputless"
    inputless.input = .none
    library.commands += [inputless, reads]
    let modes = CameraMode.modes(in: library)
    #expect(
      modes.map(\.id) == [
        BuiltinCommands.translateID, BuiltinCommands.eventID, BuiltinCommands.expenseID,
        BuiltinCommands.whiteboardID, "reads",
      ])
    // The chip shows the command's first option, such as 译成.
    #expect(modes.first?.option?.key == BuiltinCommands.OptionKey.language)
  }

  @Test func theCameraStartsInTheAskedModeThenTheLastThenTranslate() {
    let modes = CameraMode.modes(in: CommandLibrary(commands: BuiltinCommands.all()))
    let expense = BuiltinCommands.expenseID
    #expect(CameraMode.start(in: modes, asked: expense, last: nil)?.id == expense)
    #expect(
      CameraMode.start(in: modes, asked: "gone", last: BuiltinCommands.eventID)?.id
        == BuiltinCommands.eventID)
    #expect(CameraMode.start(in: modes, asked: nil, last: nil)?.id == BuiltinCommands.translateID)
    #expect(CameraMode.start(in: [], asked: expense, last: nil) == nil)
  }

  @Test func theContextFitsFourKilobytesAndKeepsTheStartMode() throws {
    let modes = (0..<60).map { index in
      CameraMode(
        id: "mode-\(index)", name: String(repeating: "名", count: 20), symbol: "camera",
        tint: .blue,
        option: CameraModeOption(key: "k", label: "选项", choices: ["一", "二", "三"], value: "一"))
    }
    let context = CameraContext(modes: modes, startModeID: "mode-59").fitted()
    #expect(try JSONEncoder().encode(context).count <= CameraContext.byteLimit)
    #expect(context.modes.contains { $0.id == "mode-59" })
    #expect(context.modes.first?.id == "mode-0")
  }
}

@Suite struct LockedCaptureTests {
  private func folder() throws -> URL {
    let url = FileManager.default.temporaryDirectory.appending(path: "locked-\(UUID())")
    try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
    return url
  }

  @Test func aShotIsReadBackWithItsModeAndOption() throws {
    let url = try folder()
    defer { try? FileManager.default.removeItem(at: url) }
    let photo = try #require(CameraFixtures.photo(lines: ["Receipt"]))
    let record = LockedCaptureRecord(
      modeID: BuiltinCommands.expenseID, values: ["book": "旅行"], capturedAt: .now)
    try LockedCaptureFolder.write(record, photo: photo, into: url)
    let read = try #require(LockedCaptureFolder.read(url))
    #expect(read.record.modeID == BuiltinCommands.expenseID)
    #expect(read.record.values == ["book": "旅行"])
    #expect(read.record.photo == "capture.jpeg")
    #expect(read.photo == photo)
    #expect(!read.record.wantsLibrary)
  }

  @Test func choosingFromTheLibraryLeavesNoPhoto() throws {
    let url = try folder()
    defer { try? FileManager.default.removeItem(at: url) }
    let record = LockedCaptureRecord(modeID: nil, values: [:], capturedAt: .now)
    try LockedCaptureFolder.write(record, photo: nil, into: url)
    #expect(LockedCaptureFolder.read(url)?.record.wantsLibrary == true)
  }

  @Test func anIncompleteFolderIsNotACapture() throws {
    let url = try folder()
    defer { try? FileManager.default.removeItem(at: url) }
    #expect(LockedCaptureFolder.read(url) == nil)
    try Data("{".utf8).write(to: url.appending(path: "capture.json"))
    #expect(LockedCaptureFolder.read(url) == nil)
    let record = LockedCaptureRecord(
      modeID: nil, values: [:], capturedAt: .now, photo: "capture.heic")
    try JSONEncoder().encode(record).write(to: url.appending(path: "capture.json"))
    // The record names a photo that is not there yet.
    #expect(LockedCaptureFolder.read(url) == nil)
  }
}
