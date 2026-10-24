import AppKit
import SwiftUI

/// A name and artwork a task row draws: the task's source, drawn as its model provider's brand
/// mark when it has one, or the app its computer use targets, taken from the run's binding/source
/// (never the foreground application).
nonisolated struct TaskActivityApplication: Equatable, Sendable {
  enum Kind: Equatable, Sendable {
    case application
    case browser
    case screen
    case unknown
    case conversation
    case command
    case automation
    case userApp
  }

  let name: String
  let bundleID: String?
  let appPath: String?
  let kind: Kind
  /// The provider brand mark's asset (``ProviderBrands``), which replaces the kind's glyph.
  var mark: String? = nil
}

/// A task's artwork: its source glyph, with the app it operates as a badge cut into the corner,
/// so computer use reads as part of the task rather than as an item of its own.
struct TaskActivityArtwork: View {
  let source: TaskActivityApplication
  let computer: TaskActivityApplication?

  private static let badge = 18.0
  /// The badge overhangs the artwork's corner; the cut leaves a gap around it.
  private static let overhang = 3.0
  private static let cut = badge + 2

  var body: some View {
    TaskActivityAppIcon(application: source, side: TaskActivityMetrics.artworkSide).equatable()
      .mask {
        ZStack(alignment: .bottomTrailing) {
          Rectangle()
          if computer != nil {
            RoundedRectangle(cornerRadius: Self.cut * 0.28, style: .continuous)
              .frame(width: Self.cut, height: Self.cut)
              .offset(x: Self.overhang + 1, y: Self.overhang + 1)
              .blendMode(.destinationOut)
          }
        }
        .compositingGroup()
      }
      .overlay(alignment: .bottomTrailing) {
        if let computer {
          TaskActivityAppIcon(application: computer, side: Self.badge).equatable()
            .offset(x: Self.overhang, y: Self.overhang)
        }
      }
      .accessibilityHidden(true)
  }
}

struct TaskActivityAppIcon: View, Equatable {
  let application: TaskActivityApplication
  let side: Double

  nonisolated static func == (lhs: Self, rhs: Self) -> Bool {
    lhs.side == rhs.side && lhs.application.kind == rhs.application.kind
      && lhs.application.bundleID == rhs.application.bundleID
      && lhs.application.appPath == rhs.application.appPath
      && lhs.application.mark == rhs.application.mark
  }

  var body: some View {
    Group {
      if let icon = Self.icon(application) {
        Image(nsImage: icon).resizable().interpolation(.high).scaledToFit()
      } else if let mark = application.mark.flatMap(NSImage.init(named:)) {
        // A monochrome mark follows the label colour; a coloured one keeps its own.
        Image(nsImage: mark).renderingMode(mark.isTemplate ? .template : .original)
          .resizable().interpolation(.high).scaledToFit()
          .frame(width: side * 0.69, height: side * 0.69)
          .foregroundStyle(.primary)
      } else {
        IslandGlyph(name: fallbackGlyph, side: side * 0.75)
          .foregroundStyle(.secondary)
      }
    }
    .frame(width: side, height: side)
    .accessibilityHidden(true)
  }

  private var fallbackGlyph: String {
    switch application.kind {
    case .application: "app-window"
    case .browser: "globe"
    case .screen: "monitor"
    case .unknown: "layers"
    case .conversation: "message-square"
    case .command: "command"
    case .automation: "clock"
    case .userApp: "app-window"
    }
  }

  private static func icon(_ application: TaskActivityApplication) -> NSImage? {
    guard application.kind == .application || application.kind == .browser,
      let bundleID = application.bundleID
    else { return nil }
    let url: URL?
    if let path = application.appPath {
      url = URL(filePath: path, directoryHint: .isDirectory)
    } else {
      url = NSWorkspace.shared.urlForApplication(withBundleIdentifier: bundleID)
    }
    guard let url, url.pathExtension == "app", Bundle(url: url)?.bundleIdentifier == bundleID else {
      return nil
    }
    return NSWorkspace.shared.icon(forFile: url.path)
  }
}
