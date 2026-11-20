import AtdAI
import AtdActions
import AtdModel
import Foundation
import SwiftUI
import Testing
import UIKit

@testable import AtdShareUI

/// Pictures of the share sheet's screens with fixture content (A19: extension views are checked
/// as images attached to the test results; `xcresulttool export attachments` saves them).
/// `WindowPicture` draws them, glass as gray stand-ins. The tests fail only when a screen draws
/// nothing.
@MainActor @Suite struct ShareSnapshotTests {
  private static let event = """
    {"title": "城市读书会 · 11 月共读", "start": "2031-03-08T14:00", "end": null, \
    "location": "静安图书馆 3 楼多功能厅", "notes": null}
    """
  private static let expense = """
    {"amount": 46, "currency": "CNY", "merchant": "南巷小馆", "category": "dining", \
    "note": "两碗面", "date": "2031-03-01T08:30"}
    """
  private static let notes = """
    {"title": "周五市集筹备", "sections": [{"heading": "摊位", "bullets": ["三号摊位靠近入口", \
    "需要两张桌子"]}, {"heading": "宣传", "bullets": ["周三前发海报"]}], "todos": [{"text": \
    "订桌布", "owner": "小周"}, {"text": "买胶带", "owner": null}]}
    """
  private let page = SharedContent.page(
    SharedPage(
      url: URL(string: "https://dushu.example.cn/nov")!, title: "城市读书会 · 11 月共读",
      text: "2031年3月8日 周六 14:00–16:00 静安图书馆 3 楼多功能厅。一起读《慢下来的城市》。"))

  @Test func theList() async throws {
    let world = ShareWorld(model: FakeModel(answering: ""))
    let session = ShareSession(services: world.services, complete: {}, dismiss: {})
    session.show(page)
    try record(ShareRootView(session: session), "list-page")
    try record(ShareRootView(session: session), "list-page-dark", dark: true)
    try record(ShareRootView(session: session), "list-page-ax", typeSize: .accessibility3)
    session.show(.text("这一段话讲的是城市里的步行和街角。"))
    try record(ShareRootView(session: session), "list-text")
  }

  @Test func aTextResult() async throws {
    let world = ShareWorld(
      model: FakeModel(answering: "· 3月8日周六 14:00 静安图书馆共读\n· 不必读完，带一段喜欢的文字\n· 结束后可交换旧书"))
    let run = ShareRun(
      command: world.command(BuiltinCommands.shortenID), content: page, services: world.services)
    run.start()
    await run.settle()
    try record(screen(run), "text-shorten")
    try record(screen(run), "text-shorten-dark", dark: true)
  }

  @Test func theCards() async throws {
    let event = try await cardRun(BuiltinCommands.eventID, Self.event, FakeCalendar(.writeOnly))
    try record(screen(event), "event")
    try record(screen(event), "event-ax", typeSize: .accessibility3)
    await event.addEvent()
    try record(screen(event), "event-done")

    let denied = try await cardRun(BuiltinCommands.eventID, Self.event, FakeCalendar(.denied))
    try record(screen(denied), "event-denied")

    let expense = try await cardRun(BuiltinCommands.expenseID, Self.expense)
    try record(screen(expense), "expense")
    expense.logExpense()
    try record(screen(expense), "expense-done-dark", dark: true)

    let notes = try await cardRun(BuiltinCommands.whiteboardID, Self.notes)
    try record(screen(notes), "notes")
    await notes.addReminders()
    try record(screen(notes), "notes-added")
  }

  // MARK: Drawing

  private func cardRun(_ id: String, _ answer: String, _ calendar: FakeCalendar = .init(.full))
    async throws -> ShareRun
  {
    let world = ShareWorld(model: FakeModel(answering: answer), calendar: calendar)
    let run = ShareRun(
      command: world.command(id), content: .text("分享的内容"), services: world.services)
    run.start()
    await run.settle()
    #expect(run.phase == .card)
    return run
  }

  private func screen(_ run: ShareRun) -> some View {
    NavigationStack { RunView(run: run, finish: {}) }
  }

  /// Draws `view` in a window the size of an iPhone 17 Pro and attaches the picture.
  private func record(
    _ view: some View, _ name: String, dark: Bool = false, typeSize: DynamicTypeSize = .large
  ) throws {
    let window = try #require(Self.window())
    let host = UIHostingController(rootView: view.dynamicTypeSize(typeSize))
    host.overrideUserInterfaceStyle = dark ? .dark : .light
    window.frame = CGRect(x: 0, y: 0, width: 402, height: 874)
    window.rootViewController = host
    window.isHidden = false
    defer { window.isHidden = true }
    // Let SwiftUI lay out and commit the screen before drawing it.
    for _ in 0..<5 { RunLoop.main.run(until: .now.addingTimeInterval(0.05)) }
    window.layoutIfNeeded()
    let picture = WindowPicture.image(of: window, scale: 3)
    // The window's background is the first thing drawn; without it nothing was.
    #expect(!Self.isBlank(picture), "\(name) drew nothing")
    Attachment.record(try #require(picture.pngData()), named: "\(name).png")
  }

  /// Whether the picture's top-left corner is empty.
  private static func isBlank(_ image: UIImage) -> Bool {
    guard let cgImage = image.cgImage else { return true }
    var pixel: [UInt8] = [0, 0, 0, 0]
    let context = CGContext(
      data: &pixel, width: 1, height: 1, bitsPerComponent: 8, bytesPerRow: 4,
      space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
    let height = CGFloat(cgImage.height)
    context?.draw(
      cgImage, in: CGRect(x: 0, y: 1 - height, width: CGFloat(cgImage.width), height: height))
    return pixel[3] == 0
  }

  /// A window to draw in: in the app's scene when the tests run inside an app, else one of
  /// its own, which UIKit still lays out and draws though nothing shows it.
  private static func window() -> UIWindow? {
    let application = (UIApplication.self as AnyObject).value(forKey: "sharedApplication")
    if let scene = (application as? UIApplication)?.connectedScenes.lazy
      .compactMap({ $0 as? UIWindowScene }).first
    {
      return UIWindow(windowScene: scene)
    }
    // A scene-less window, made through NSObject's initializer: hostless test runs have no
    // scene, and UIWindow's own scene-less initializers are deprecated.
    let type: NSObject.Type = UIWindow.self
    return type.init() as? UIWindow
  }
}
