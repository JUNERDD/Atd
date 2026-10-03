import AICore
import AppKit

/// What the application menu and the status item's menu can do.
struct AppMenuActions {
  var showPanel: () -> Void
  var hidePanel: () -> Void
  var openSettings: () -> Void
  var openOnboarding: () -> Void
  /// Debug builds only: runs the first launch's welcome guide path again; nil in Release.
  var replayOnboarding: (() -> Void)?
  /// Nil where the build does not update (Debug).
  var checkForUpdates: (() -> Void)?
  var restartService: () async throws -> Void
  var showServiceLogs: () async throws -> Void
  /// Undo or Redo for the key window's page (`edit.command`).
  var editCommand: (_ command: EditCommandEvent.Command) -> Void
  /// A Debug build waiting for `pnpm dev`: the status menu says so first.
  var developmentHint: () -> Bool
  /// Whether the selection toolbar's `toggle` mode listens, or nil while that mode is not in
  /// effect; the status menu shows it as a checkable item.
  var selectionListening: () -> Bool?
  var setSelectionListening: (Bool) -> Void
}

/// The app's menus.
enum AppMenus {
  /// Panel, settings, welcome guide and service items, then Quit. The status item and the
  /// application menu share them, since a hidden Dock icon hides the application menu.
  static func appItems(_ actions: AppMenuActions) -> [NSMenuItem] {
    let strings = ShellStrings.shared
    let quit = NSMenuItem(
      title: strings.text(.menuQuit), action: #selector(NSApplication.terminate(_:)),
      keyEquivalent: "q")
    var items: [NSMenuItem] = [
      ActionMenuItem(strings.text(.menuShowPanel), actions.showPanel),
      ActionMenuItem(strings.text(.menuHidePanel), actions.hidePanel),
      ActionMenuItem(strings.text(.menuSettings), key: ",", actions.openSettings),
      ActionMenuItem(strings.text(.menuOnboarding), actions.openOnboarding),
    ]
    if let replayOnboarding = actions.replayOnboarding {
      items.append(ActionMenuItem(strings.text(.menuOnboardingReplay), replayOnboarding))
    }
    if let checkForUpdates = actions.checkForUpdates {
      items.append(ActionMenuItem(strings.text(.menuCheckForUpdates), checkForUpdates))
    }
    return items + [
      .separator(),
      ActionMenuItem(strings.text(.menuRestartService)) {
        reportFailure(
          actions.restartService, .errorRestartServiceTitle, .errorRestartServiceMessage)
      },
      ActionMenuItem(strings.text(.menuShowServiceLogs)) {
        reportFailure(actions.showServiceLogs, .errorShowLogsTitle, .errorShowLogsMessage)
      },
      .separator(),
      quit,
    ]
  }

  static func statusMenu(_ actions: AppMenuActions) -> NSMenu {
    let menu = NSMenu()
    if actions.developmentHint() {
      let hint = NSMenuItem(
        title: ShellStrings.shared.text(.menuDevelopmentHint), action: nil, keyEquivalent: "")
      hint.isEnabled = false
      menu.addItem(hint)
      menu.addItem(.separator())
    }
    menu.autoenablesItems = false
    if let listening = actions.selectionListening() {
      let item = ActionMenuItem(ShellStrings.shared.text(.menuSelectionListening)) {
        actions.setSelectionListening(!listening)
      }
      item.state = listening ? .on : .off
      menu.addItem(item)
      menu.addItem(.separator())
    }
    for item in appItems(actions) { menu.addItem(item) }
    return menu
  }

  /// The application menu: the app's items, Edit, and View in Debug builds.
  static func mainMenu(_ actions: AppMenuActions) -> NSMenu {
    let strings = ShellStrings.shared
    let main = NSMenu()
    let app = NSMenu(title: strings.text(.appName))
    for item in appItems(actions) { app.addItem(item) }
    main.addItem(submenu: app, title: strings.text(.appName))
    main.addItem(submenu: editMenu(actions), title: strings.text(.menuEdit))
    #if DEBUG
      let view = NSMenu(title: strings.text(.menuView))
      view.addItem(
        NSMenuItem(
          title: strings.text(.menuReload), action: #selector(WKWebViewActions.reload(_:)),
          keyEquivalent: "r"))
      main.addItem(submenu: view, title: strings.text(.menuView))
    #endif
    return main
  }

  /// Undo and Redo go to the page as `edit.command`: WebKit's undo stack never sees the edits
  /// CodeMirror handles itself. The page receives shortcuts first; only unhandled ones reach
  /// these items. Cut, Copy, Paste and Select All stay responder-chain actions.
  private static func editMenu(_ actions: AppMenuActions) -> NSMenu {
    let strings = ShellStrings.shared
    let menu = NSMenu(title: strings.text(.menuEdit))
    menu.addItem(ActionMenuItem(strings.text(.menuUndo), key: "z") { actions.editCommand(.undo) })
    let redo = ActionMenuItem(strings.text(.menuRedo), key: "z") { actions.editCommand(.redo) }
    redo.keyEquivalentModifierMask = [.command, .shift]
    menu.addItem(redo)
    menu.addItem(.separator())
    menu.addItem(item(.menuCut, "cut:", "x"))
    menu.addItem(item(.menuCopy, "copy:", "c"))
    menu.addItem(item(.menuPaste, "pasteAttachingFiles:", "v"))
    let plain = item(.menuPasteAndMatchStyle, "pasteAsPlainText:", "v")
    plain.keyEquivalentModifierMask = [.command, .option, .shift]
    menu.addItem(plain)
    menu.addItem(item(.menuDelete, "delete:", ""))
    menu.addItem(item(.menuSelectAll, "selectAll:", "a"))
    menu.addItem(.separator())
    let substitutions = NSMenu(title: strings.text(.menuSubstitutions))
    substitutions.addItem(item(.menuShowSubstitutions, "orderFrontSubstitutionsPanel:", ""))
    substitutions.addItem(.separator())
    substitutions.addItem(item(.menuSmartQuotes, "toggleAutomaticQuoteSubstitution:", ""))
    substitutions.addItem(item(.menuSmartDashes, "toggleAutomaticDashSubstitution:", ""))
    substitutions.addItem(item(.menuTextReplacement, "toggleAutomaticTextReplacement:", ""))
    menu.addItem(submenu: substitutions, title: strings.text(.menuSubstitutions))
    let speech = NSMenu(title: strings.text(.menuSpeech))
    speech.addItem(item(.menuStartSpeaking, "startSpeaking:", ""))
    speech.addItem(item(.menuStopSpeaking, "stopSpeaking:", ""))
    menu.addItem(submenu: speech, title: strings.text(.menuSpeech))
    return menu
  }

  /// A responder-chain item: enabled when the first responder handles `action`.
  private static func item(_ key: ShellStringKey, _ action: String, _ equivalent: String)
    -> NSMenuItem
  {
    NSMenuItem(
      title: ShellStrings.shared.text(key), action: Selector(action), keyEquivalent: equivalent)
  }

  /// Runs a service action and shows an alert when it fails.
  private static func reportFailure(
    _ action: @escaping () async throws -> Void, _ title: ShellStringKey,
    _ fallback: ShellStringKey
  ) {
    Task {
      do {
        try await action()
      } catch {
        let alert = NSAlert()
        alert.alertStyle = .warning
        alert.messageText = ShellStrings.shared.text(title)
        let message = (error as? LocalizedError)?.errorDescription
        alert.informativeText = message ?? ShellStrings.shared.text(fallback)
        NSApp.activate()
        _ = await NestedRunLoop.runModal(alert)
      }
    }
  }
}

/// A menu item that runs a closure.
final class ActionMenuItem: NSMenuItem {
  private let handler: () -> Void

  init(_ title: String, key: String = "", _ handler: @escaping () -> Void) {
    self.handler = handler
    super.init(title: title, action: #selector(run), keyEquivalent: key)
    target = self
  }

  // NSMenuItem's initializers are nonisolated; under the target's main-actor default the
  // overrides Swift would otherwise synthesize for them conflict, so they are spelled out.
  @available(*, unavailable)
  nonisolated override init(title: String, action: Selector?, keyEquivalent: String) {
    fatalError("init(title:action:keyEquivalent:) is not supported")
  }

  @available(*, unavailable)
  nonisolated required init(coder: NSCoder) { fatalError("init(coder:) is not supported") }

  @objc private func run() { handler() }
}

/// Selectors WKWebView answers through the responder chain.
@objc private protocol WKWebViewActions {
  func reload(_ sender: Any?)
}

extension NSMenu {
  fileprivate func addItem(submenu: NSMenu, title: String) {
    let item = NSMenuItem(title: title, action: nil, keyEquivalent: "")
    item.submenu = submenu
    addItem(item)
  }
}

extension AppMenuActions {
  /// Actions of a controller that is gone; the menu still builds.
  static var inert: AppMenuActions {
    AppMenuActions(
      showPanel: {}, hidePanel: {}, openSettings: {}, openOnboarding: {}, replayOnboarding: nil,
      checkForUpdates: nil,
      restartService: {}, showServiceLogs: {}, editCommand: { _ in }, developmentHint: { false },
      selectionListening: { nil }, setSelectionListening: { _ in })
  }
}
