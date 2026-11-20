import AtdIntents
import AtdModel
import Foundation
import SwiftUI
import Testing
import UIKit
import WidgetKit

@testable import AtdWidgetsUI

/// Snapshots of the widgets, the Lock Screen accessories and the Live Activity, which the
/// simulator cannot show without someone adding them (A19). Each is attached to the test result
/// as a PNG, and each checks that its content fits the space its family has on a 393-pt-wide
/// iPhone, the smallest size most current iPhones give it. Text follows Dynamic Type up to a
/// largest size each surface sets, so the checks run at the default size and at the largest.
@MainActor
struct EntryRenderTests {
  /// The system's content margins inside a Home Screen widget.
  private static let margin: CGFloat = 16
  /// The default text size and the largest one, which each surface caps at its own largest size.
  private static let typeSizes: [DynamicTypeSize] = [.large, .accessibility5]

  @Test(arguments: [ColorScheme.light, .dark])
  func commandsWidgetFitsBothSizes(_ scheme: ColorScheme) throws {
    for (family, width, height) in [
      (WidgetFamily.systemSmall, 158.0, 158.0), (.systemMedium, 338, 158),
    ] {
      let fitted = try size(
        of: CommandsWidgetView(family: family), width: width - 2 * Self.margin, scheme: scheme)
      #expect(fitted.height <= height - 2 * Self.margin, "\(family): \(fitted.height)")
      // Larger names shrink to fit their buttons, which only the widget's own frame shows.
      for type in Self.typeSizes {
        try record(
          CommandsWidgetView(family: family).dynamicTypeSize(type).padding(Self.margin)
            .frame(width: width, height: height).background(Color(uiColor: .systemBackground)),
          named: "commands-\(family)-\(type)-\(scheme)", scheme: scheme)
      }
    }
  }

  @Test(arguments: [DynamicTypeSize.large, .accessibility5])
  func nextItemFitsTheRectangularAccessory(_ type: DynamicTypeSize) throws {
    let today = NextItem(
      event: AgendaEvent(
        title: "和设计团队一起评审下一版首页", start: .now, end: .now.addingTimeInterval(3_600),
        isAllDay: false, location: "三楼大会议室"),
      day: .today)
    let tomorrow = NextItem(
      event: AgendaEvent(title: "Flight", start: .now, end: .now, isAllDay: true), day: .tomorrow)
    let states: [(String, NextItemState)] = [
      ("today", .item(today)), ("tomorrow", .item(tomorrow)), ("none", .item(nil)),
      ("access", .needsAccess),
    ]
    for (name, state) in states {
      let view = NextItemView(state: state).dynamicTypeSize(type).foregroundStyle(.white)
      let fitted = try size(of: view, width: 160, scheme: .dark)
      #expect(fitted.height <= 72, "\(name): \(fitted.height)")
      try record(
        view.frame(width: 160, height: 72).background(.black),
        named: "next-\(name)-\(type)", scheme: .dark)
    }
  }

  @Test func lockButtonsShowGlyphAndName() throws {
    for (name, symbol, label) in [
      ("ask", "waveform", EntryCopy.string("widget.ask")),
      ("expense", "receipt", EntryCopy.string("widget.expense")),
    ] {
      for type in Self.typeSizes {
        try record(
          LockButtonView(symbol: symbol, label: label).dynamicTypeSize(type)
            .foregroundStyle(.white).frame(width: 72, height: 72).background(.black),
          named: "lock-\(name)-\(type)", scheme: .dark)
      }
    }
  }

  @Test(arguments: [ColorScheme.light, .dark])
  func liveActivityFitsTheLockScreenInEveryPhase(_ scheme: ColorScheme) throws {
    let briefing = try #require(BuiltinCommands.all().first { $0.id == BuiltinCommands.briefingID })
    let attributes = BriefingActivityAttributes(command: briefing, day: .now)
    typealias State = BriefingActivityAttributes.ContentState
    // Sentences longer than the rows they get, in both languages.
    let chinese = String(
      repeating: "十点和设计团队在三楼大会议室评审首页改版，记得带上第三季度的数据。", count: 3)
    let english = String(
      repeating: "Lunch with the design team in the big room on the third floor ", count: 3)
    let phases: [(String, State, Bool)] = [
      ("working", State(phase: .working), false),
      ("stale", State(phase: .working), true),
      ("done", State(phase: .done, lines: [chinese, chinese, chinese]), false),
      ("doneEnglish", State(phase: .done, lines: [english, english, english]), false),
      ("needsAccess", State(phase: .needsAccess), false),
      ("noModel", State(phase: .noModel), false),
      (
        "failed", State(phase: .failed, message: "网络好像断了，过一会儿再试一次。", canRetry: true),
        false
      ),
    ]
    for (name, state, stale) in phases {
      // The default size, the first larger one, and the largest the activity allows.
      for type in [DynamicTypeSize.large, .xLarge, .accessibility5] {
        let view = BriefingActivityLockView(attributes: attributes, state: state, isStale: stale)
          .dynamicTypeSize(type)
        // Apple caps a Lock Screen Live Activity at 160 points; it is 371 wide here.
        let fitted = try size(of: view, width: 371, scheme: scheme)
        #expect(fitted.height <= 160, "\(name) at \(type): \(fitted.height)")
        if type == .large || state.phase == .done {
          try record(
            view.frame(width: 371).background(Color(uiColor: .systemBackground)),
            named: "activity-\(name)-\(type)-\(scheme)", scheme: scheme)
        }
      }
    }
  }

  // MARK: Rendering

  /// The size `view` takes at `width`, at its ideal height.
  private func size(of view: some View, width: CGFloat, scheme: ColorScheme) throws -> CGSize {
    let renderer = ImageRenderer(
      content: view.frame(width: width).fixedSize(horizontal: false, vertical: true)
        .environment(\.colorScheme, scheme))
    let image = try #require(renderer.uiImage)
    return image.size
  }

  /// Attaches `view` as a PNG at three times its size.
  private func record(_ view: some View, named name: String, scheme: ColorScheme) throws {
    let renderer = ImageRenderer(content: view.environment(\.colorScheme, scheme))
    renderer.scale = 3
    let data = try #require(renderer.uiImage?.pngData())
    Attachment.record(data, named: "\(name).png")
  }
}
