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
/// as a PNG, and each checks that its content fits the space its family has on an iPhone 17 Pro.
@MainActor
struct EntryRenderTests {
  /// The system's content margins inside a Home Screen widget.
  private static let margin: CGFloat = 16

  @Test(arguments: [ColorScheme.light, .dark])
  func commandsWidgetFitsBothSizes(_ scheme: ColorScheme) throws {
    for (family, width, height) in [
      (WidgetFamily.systemSmall, 170.0, 170.0), (.systemMedium, 364, 170),
    ] {
      let face = CommandsWidgetView(family: family)
      let fitted = try size(of: face, width: width - 2 * Self.margin, scheme: scheme)
      #expect(fitted.height <= height - 2 * Self.margin, "\(family)")
      try record(
        face.padding(Self.margin).frame(width: width, height: height)
          .background(Color(uiColor: .systemBackground)),
        named: "commands-\(family)-\(scheme)", scheme: scheme)
    }
  }

  @Test(arguments: [DynamicTypeSize.large, .accessibility2])
  func nextItemFitsTheRectangularAccessory(_ type: DynamicTypeSize) throws {
    let today = NextItem(
      event: AgendaEvent(
        title: "Design review with the whole team", start: .now,
        end: .now.addingTimeInterval(3_600),
        isAllDay: false, location: "Room 2"),
      day: .today)
    let tomorrow = NextItem(
      event: AgendaEvent(title: "Flight", start: .now, end: .now, isAllDay: true), day: .tomorrow)
    let states: [(String, NextItemState)] = [
      ("today", .item(today)), ("tomorrow", .item(tomorrow)), ("none", .item(nil)),
      ("access", .needsAccess),
    ]
    for (name, state) in states {
      let view = NextItemView(state: state).dynamicTypeSize(type).foregroundStyle(.white)
      // At accessibility sizes the text may outgrow the accessory, which then truncates it;
      // the snapshot shows how.
      if !type.isAccessibilitySize {
        #expect(try size(of: view, width: 170, scheme: .dark).height <= 76, "\(name)")
      }
      try record(
        view.frame(width: 170, height: 76).background(.black),
        named: "next-\(name)-\(type)", scheme: .dark)
    }
  }

  @Test func lockButtonsShowGlyphAndName() throws {
    for (name, symbol, label) in [
      ("ask", "waveform", EntryCopy.string("widget.ask")),
      ("expense", "receipt", EntryCopy.string("widget.expense")),
    ] {
      try record(
        LockButtonView(symbol: symbol, label: label).foregroundStyle(.white)
          .frame(width: 72, height: 72).background(.black),
        named: "lock-\(name)", scheme: .dark)
    }
  }

  @Test(arguments: [ColorScheme.light, .dark])
  func liveActivityFitsTheLockScreenInEveryPhase(_ scheme: ColorScheme) throws {
    let briefing = try #require(BuiltinCommands.all().first { $0.id == BuiltinCommands.briefingID })
    let attributes = BriefingActivityAttributes(command: briefing, day: .now)
    typealias State = BriefingActivityAttributes.ContentState
    let long = String(
      repeating: "Lunch with the design team in the big room on the third floor ", count: 3)
    let phases: [(String, State, Bool)] = [
      ("working", State(phase: .working), false),
      ("stale", State(phase: .working), true),
      ("done", State(phase: .done, lines: [long, long, long]), false),
      ("needsAccess", State(phase: .needsAccess), false),
      ("noModel", State(phase: .noModel), false),
      (
        "failed", State(phase: .failed, message: "The network seems to be down.", canRetry: true),
        false
      ),
    ]
    for (name, state, stale) in phases {
      let view = BriefingActivityLockView(attributes: attributes, state: state, isStale: stale)
      // Apple caps a Lock Screen Live Activity at 160 points.
      let fitted = try size(of: view, width: 370, scheme: scheme)
      #expect(fitted.height <= 160, "\(name)")
      try record(
        view.frame(width: 370).background(Color(uiColor: .systemBackground)),
        named: "activity-\(name)-\(scheme)", scheme: scheme)
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
