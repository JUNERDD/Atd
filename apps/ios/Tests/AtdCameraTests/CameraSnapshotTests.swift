import AtdAI
import AtdCameraUI
import AtdInk
import AtdModel
import SwiftUI
import Testing
import UIKit

@testable import AtdAppUI

/// Draws what no simulator session reaches, the Lock Screen camera, and the camera's answers as
/// they read with fixed content (marks on a photo, the cards), and attaches the drawings to the
/// test results. Export them with `xcrun xcresulttool export attachments`.
@MainActor @Suite struct CameraSnapshotTests {
  /// iPhone 17 Pro, in points.
  private static let phone = CGSize(width: 402, height: 874)

  private func attach(
    _ view: some View, named name: String, height: CGFloat? = phone.height,
    scheme: ColorScheme = .light
  ) throws {
    let renderer = ImageRenderer(
      content: view.frame(width: Self.phone.width, height: height)
        .environment(\.colorScheme, scheme))
    renderer.scale = 2
    let png = try #require(renderer.uiImage?.pngData())
    Attachment.record(png, named: "\(name).png")
  }

  private var library: CommandLibrary { CommandLibrary(commands: BuiltinCommands.all()) }

  private func command(_ id: String) throws -> Command {
    try #require(library.commands.first { $0.id == id })
  }

  @Test func lockScreenCamera() throws {
    let context = CameraContext(
      modes: CameraMode.modes(in: library), startModeID: BuiltinCommands.expenseID)
    try attach(
      LockedCaptureScreen(
        folder: .temporaryDirectory, open: {}, capture: CameraCapture(status: .unavailable),
        context: context),
      named: "locked-unavailable-expense")
    try attach(
      LockedCaptureScreen(
        folder: .temporaryDirectory, open: {}, capture: CameraCapture(status: .denied),
        context: CameraContext(modes: [], startModeID: nil)),
      named: "locked-denied-no-modes")
  }

  @Test func marksOnAReadPhoto() async throws {
    let photo = try #require(
      CameraFixtures.photo(lines: ["GREEN TEA 300", "COFFEE 450", "TOTAL 750"]))
    let shot = try #require(await CameraReader.read(photo))
    func line(_ text: String) throws -> Int {
      try #require(shot.lines.first { $0.text.uppercased().contains(text) }?.id)
    }
    let translation = CameraTranslation(
      title: "Menu",
      items: [
        .init(id: 1, lines: [try line("TEA")], text: "绿茶", price: "300", approx: "≈ 15 元"),
        .init(id: 2, lines: [try line("COFFEE")], text: "咖啡", price: "450"),
      ])
    let inset = CameraResultSheet.height
    try attach(
      CameraStage(
        shot: shot, answer: .translation(translation), reading: false, bottomInset: inset),
      named: "stage-translation")
    let receipt = CardResult.expense(
      ExpenseDraft(amount: 750, currency: "JPY", category: .dining, date: .now, book: "日常"))
    let marks = [
      CameraMark(number: 1, fields: [.merchant], lines: [try line("TEA"), try line("COFFEE")]),
      CameraMark(number: 2, fields: [.total], lines: [try line("TOTAL")]),
    ]
    try attach(
      CameraStage(
        shot: shot, answer: .card(receipt, marks: marks), reading: false, bottomInset: inset),
      named: "stage-expense")
    try attach(
      CameraStage(shot: shot, answer: nil, reading: true, bottomInset: 0), named: "stage-reading")
  }

  @Test func cards() throws {
    let directory = FileManager.default.temporaryDirectory.appending(path: "cards-\(UUID())")
    defer { try? FileManager.default.removeItem(at: directory) }
    let store = AppStore(
      store: SharedStore(directory: directory, notificationName: nil), secrets: NoSecrets())
    let start = Date.now.addingTimeInterval(86_400)
    let event = EventDraft(
      title: "读书会", start: start, end: start.addingTimeInterval(7_200),
      location: "静安图书馆 3 楼", alert: .hourBefore)
    let notes = NotesCard(
      title: "周会",
      sections: [
        NotesCard.Section(heading: "进度", bullets: ["登录页上线", "支付联调完成"]),
        NotesCard.Section(heading: "风险", bullets: ["安卓人手不足"]),
      ],
      todos: [
        NotesCard.Todo(text: "补齐埋点", owner: "小林"), NotesCard.Todo(text: "周五前发版本说明", owner: nil),
      ])
    let translation = CameraTranslation(
      title: "日文菜单",
      items: [
        .init(id: 1, lines: [2, 3], text: "烤鸡串拼盘（5 串）", price: "¥980", approx: "≈ 46 元"),
        .init(id: 2, lines: [4], text: "生啤（中杯）", price: "¥550", approx: "≈ 26 元"),
      ])
    let translate = try command(BuiltinCommands.translateID)
    let expense = try command(BuiltinCommands.expenseID)
    let extract = try command(BuiltinCommands.eventID)
    let whiteboard = try command(BuiltinCommands.whiteboardID)
    var own = try command(BuiltinCommands.shortenID)
    own.placement.camera = true
    let cards = VStack(alignment: .leading, spacing: 40) {
      CameraTranslateCard(
        command: translate, translation: translation,
        streaming: false, photo: nil, ask: { _ in })
      CameraExpenseCard(
        command: expense,
        draft: ExpenseDraft(
          amount: 46, currency: "CNY", merchant: "全家便利店", category: .dining, date: .now,
          book: "日常"),
        marks: [
          CameraMark(number: 1, fields: [.merchant], lines: [1]),
          CameraMark(number: 2, fields: [.time], lines: [2]),
          CameraMark(number: 3, fields: [.total], lines: [5]),
        ])
      CameraEventCard(
        command: extract, draft: event,
        marks: [
          CameraMark(number: 1, fields: [.date, .time], lines: [1]),
          CameraMark(number: 2, fields: [.place], lines: [2]),
        ])
      CameraNotesCard(
        command: whiteboard, notes: notes,
        marks: [
          CameraMark(number: 1, fields: [.section(1)], lines: [1, 2]),
          CameraMark(number: 2, fields: [.section(2)], lines: [3]),
        ])
      CameraTextCard(
        command: own, card: .text(TextCard(text: "出口在左手边，3 号门。")), photo: nil,
        ask: { _ in })
    }
    .padding(20)
    .background(InkColor.paper)
    .environment(store)
    try attach(cards, named: "cards-light", height: nil)
    try attach(cards, named: "cards-dark", height: nil, scheme: .dark)
  }
}

/// No keys: the snapshots run nothing.
private struct NoSecrets: SecretStoring {
  func key(for connectionID: String) throws -> String? { nil }
  func setKey(_ key: String, for connectionID: String) throws {}
  func removeKey(for connectionID: String) throws {}
}
