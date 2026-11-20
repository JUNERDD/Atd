import AtdModel
import Foundation
import SwiftUI
import Testing

@testable import AtdAutomations
@testable import AtdWidgetsUI

/// The Live Activities as the Lock Screen shows them, drawn with `ImageRenderer` and attached to
/// the test results: a run going, waiting for the person, finished with a failure, and
/// stopped; the focus timer timing and ended. Each fits the 160 points the Lock Screen gives an
/// activity before it cuts it off.
@MainActor
@Suite struct ActivitySnapshotTests {
  /// An activity's width on iPhone 17 Pro's Lock Screen.
  private static let width: CGFloat = 370
  private static let maxHeight: CGFloat = 160

  private static func step(_ status: StepRecord.Status, _ text: String) -> RunState.Step {
    RunState.Step(status: status, text: text)
  }

  private static let runs: [(String, RunState)] = [
    (
      "running",
      RunState(
        phase: .running, current: 1,
        steps: [
          step(.done, "明天 9:30 和设计组开会，还有 2 项"), step(.running, "正在总结今天的账…"),
          step(.waiting, "发给妈妈“到家了”"), step(.waiting, "润色"), step(.waiting, "今日简报"),
        ])
    ),
    (
      "awaiting",
      RunState(
        phase: .awaiting, current: 1,
        steps: [
          step(.done, "明天 9:30 和设计组开会"), step(.waiting, "发给妈妈：“到家了”"),
          step(.waiting, "总结今天的账"),
        ])
    ),
    (
      "finished",
      RunState(
        phase: .finished, current: 2,
        steps: [
          step(.done, "明天 9:30 和设计组开会"), step(.failed, "没有可用的模型"),
          step(.done, "今天 2 笔，共 ¥68"),
        ], failures: 1)
    ),
    ("interrupted", RunState(phase: .interrupted, current: 0, steps: [step(.waiting, "今日简报")])),
  ]

  @Test func aRunsActivityFitsTheLockScreen() throws {
    let attributes = AutomationActivityAttributes(
      runID: UUID(), automationID: "home", name: "到家清单", symbol: "house", tint: .orange)
    // A running activity that stopped updating (Atd was closed mid-step) reads as stopped.
    let stale = ("stale", Self.runs[0].1, true)
    for (name, state, isStale) in Self.runs.map({ ($0.0, $0.1, false) }) + [stale] {
      for scheme in [ColorScheme.light, .dark] {
        let view = AutomationLockScreenView(attributes: attributes, state: state, isStale: isStale)
        let size = try Self.record(view, named: "automation-\(name)", scheme: scheme)
        #expect(size.height <= Self.maxHeight, "\(name) is \(size.height) points tall")
      }
    }
  }

  @Test func theFocusTimerFitsTheLockScreen() throws {
    let start = Date.now.addingTimeInterval(-1512)
    let attributes = FocusActivityAttributes(
      sessionID: UUID(), automationID: "desk", label: "书桌", start: start)
    let states: [(String, FocusActivityAttributes.ContentState)] = [
      ("timing", .init()), ("ended", .init(end: .now)),
    ]
    for (name, state) in states {
      for scheme in [ColorScheme.light, .dark] {
        let view = FocusLockScreenView(attributes: attributes, state: state)
        let size = try Self.record(view, named: "focus-\(name)", scheme: scheme)
        #expect(size.height <= Self.maxHeight, "\(name) is \(size.height) points tall")
      }
    }
  }

  /// Draws `view` at the activity's width on a platter-like backdrop and attaches it as a PNG;
  /// returns its size in points.
  private static func record(_ view: some View, named name: String, scheme: ColorScheme) throws
    -> CGSize
  {
    let content =
      view
      .frame(width: width)
      .background(scheme == .dark ? Color(white: 0.14) : Color(white: 0.95))
      .environment(\.colorScheme, scheme)
    let renderer = ImageRenderer(content: content)
    renderer.scale = 3
    let image = try #require(renderer.uiImage)
    let png = try #require(image.pngData())
    Attachment.record(png, named: "\(name)-\(scheme == .dark ? "dark" : "light").png")
    return image.size
  }
}
