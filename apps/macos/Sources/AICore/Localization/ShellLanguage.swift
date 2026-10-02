/// The languages the native surfaces ship. The raw value is the `.lproj` the String Catalog
/// compiles to.
public enum ShellLanguage: String, CaseIterable, Sendable {
  case english = "en"
  case simplifiedChinese = "zh-Hans"

  /// The service's `language` setting (`APP_LANGUAGES`: `en`, `zh-CN`), pushed by the page.
  public init?(appLanguage: String) {
    switch appLanguage {
    case "en": self = .english
    case "zh-CN": self = .simplifiedChinese
    default: return nil
    }
  }

  /// Until the page pushes the setting: the renderer's `resolveLanguage` applied to the first
  /// preferred system language, so both sides start in the same language.
  public static func system(preferredLanguages: [String]) -> ShellLanguage {
    preferredLanguages.first?.lowercased().hasPrefix("zh") == true ? .simplifiedChinese : .english
  }
}

/// Every native string, by its String Catalog key (apps/macos/App/Localizable.xcstrings). A
/// test keeps this list and the catalog identical, with both languages translated.
public enum ShellStringKey: String, CaseIterable, Sendable {
  case appName = "app.name"
  case windowPanelTitle = "window.panel.title"
  case windowSettingsTitle = "window.settings.title"

  case menuShowPanel = "menu.showPanel"
  case menuHidePanel = "menu.hidePanel"
  case menuSettings = "menu.settings"
  case menuRestartService = "menu.restartService"
  case menuShowServiceLogs = "menu.showServiceLogs"
  case menuQuit = "menu.quit"
  case menuDevelopmentHint = "menu.developmentHint"

  case menuEdit = "menu.edit"
  case menuUndo = "menu.edit.undo"
  case menuRedo = "menu.edit.redo"
  case menuCut = "menu.edit.cut"
  case menuCopy = "menu.edit.copy"
  case menuPaste = "menu.edit.paste"
  case menuPasteAndMatchStyle = "menu.edit.pasteAndMatchStyle"
  case menuDelete = "menu.edit.delete"
  case menuSelectAll = "menu.edit.selectAll"
  case menuSubstitutions = "menu.edit.substitutions"
  case menuShowSubstitutions = "menu.edit.showSubstitutions"
  case menuSmartQuotes = "menu.edit.smartQuotes"
  case menuSmartDashes = "menu.edit.smartDashes"
  case menuTextReplacement = "menu.edit.textReplacement"
  case menuSpeech = "menu.edit.speech"
  case menuStartSpeaking = "menu.edit.startSpeaking"
  case menuStopSpeaking = "menu.edit.stopSpeaking"
  case menuView = "menu.view"
  case menuReload = "menu.view.reload"

  case statusUnavailable = "status.unavailable"
  case statusRunning = "status.running"
  case statusAttention = "status.attention"
  case statusDevelopmentHint = "status.developmentHint"

  case errorRestartServiceTitle = "error.restartService.title"
  case errorRestartServiceMessage = "error.restartService.message"
  case errorShowLogsTitle = "error.showLogs.title"
  case errorShowLogsMessage = "error.showLogs.message"
  case errorDevelopmentRestart = "error.developmentRestart"
  case errorDevelopmentLogs = "error.developmentLogs"

  case quitTitle = "quit.title"
  case quitMessageOne = "quit.message.one"
  case quitMessageOther = "quit.message.other"
  case quitDetail = "quit.detail"
  case quitConfirm = "quit.confirm"
  case cancel = "common.cancel"

  case filePickTitle = "file.pick.title"
  case fileSaveTitle = "file.save.title"
  case fileSaveFailed = "file.save.failed"
  case fileSaveInvalidImage = "file.save.invalidImage"

  case artifactOpenTitle = "artifact.open.title"
  case artifactOpenMessage = "artifact.open.message"
  case artifactOpenShowInFinder = "artifact.open.showInFinder"
  case artifactOpenAnyway = "artifact.open.openAnyway"

  case mcpApprovalTitle = "mcpApproval.title"
  case mcpApprovalMessageUser = "mcpApproval.message.user"
  case mcpApprovalMessagePlugin = "mcpApproval.message.plugin"
  case mcpApprovalMessageHttp = "mcpApproval.message.http"
  case mcpApprovalMessageChanged = "mcpApproval.message.changed"
  case mcpApprovalAllow = "mcpApproval.allow"
  case mcpApprovalServer = "mcpApproval.field.server"
  case mcpApprovalType = "mcpApproval.field.type"
  case mcpApprovalUserServer = "mcpApproval.layer.user"
  case mcpApprovalPluginServer = "mcpApproval.layer.plugin"
  case mcpApprovalPlugin = "mcpApproval.field.plugin"
  case mcpApprovalSource = "mcpApproval.field.source"
  case mcpApprovalRevision = "mcpApproval.field.revision"
  case mcpApprovalCommand = "mcpApproval.field.command"
  case mcpApprovalResolvedCommand = "mcpApproval.field.resolvedCommand"
  case mcpApprovalArguments = "mcpApproval.field.arguments"
  case mcpApprovalWorkingDirectory = "mcpApproval.field.workingDirectory"
  case mcpApprovalEnvironment = "mcpApproval.field.environment"
  case mcpApprovalEnvironmentInherited = "mcpApproval.environment.inherited"
  case mcpApprovalEnvironmentOnly = "mcpApproval.environment.only"
  case mcpApprovalNone = "mcpApproval.none"
  case mcpApprovalHiddenValue = "mcpApproval.hiddenValue"
  case mcpApprovalRisky = "mcpApproval.flag.risky"
  case mcpApprovalUrl = "mcpApproval.field.url"
  case mcpApprovalReadsEnv = "mcpApproval.flag.readsEnv"
  case mcpApprovalHeaders = "mcpApproval.field.headers"
  case mcpApprovalTokenEnv = "mcpApproval.field.tokenEnv"
  case mcpApprovalSentEnv = "mcpApproval.field.sentEnv"

  case captureHintIdle = "capture.hint.idle"
  case captureHintSelected = "capture.hint.selected"
  case captureHintAccessibility = "capture.hint.accessibility"
  case captureHintRecall = "capture.hint.recall"
  case captureHintWindowsOnly = "capture.hint.windowsOnly"
  case captureToolbar = "capture.toolbar"
  case captureToolbarMove = "capture.toolbar.move"
  case captureStyleBar = "capture.styleBar"
  /// `%1$@` the action, `%2$@` its key.
  case captureTooltipShortcut = "capture.tooltip.shortcut"
  case captureToolSelect = "capture.tool.select"
  case captureToolRectangle = "capture.tool.rectangle"
  case captureToolEllipse = "capture.tool.ellipse"
  case captureToolArrow = "capture.tool.arrow"
  case captureToolLine = "capture.tool.line"
  case captureToolPen = "capture.tool.pen"
  case captureToolHighlighter = "capture.tool.highlighter"
  case captureToolText = "capture.tool.text"
  case captureToolMosaic = "capture.tool.mosaic"
  case captureToolStep = "capture.tool.step"
  case captureToolSpotlight = "capture.tool.spotlight"
  case captureTextBackground = "capture.textBackground"
  case captureColorRed = "capture.color.red"
  case captureColorYellow = "capture.color.yellow"
  case captureColorGreen = "capture.color.green"
  case captureColorBlue = "capture.color.blue"
  case captureColorBlack = "capture.color.black"
  case captureColorWhite = "capture.color.white"
  case captureStrokeThin = "capture.stroke.thin"
  case captureStrokeMedium = "capture.stroke.medium"
  case captureStrokeThick = "capture.stroke.thick"
  case captureUndo = "capture.undo"
  case captureRedo = "capture.redo"
  case captureConfirm = "capture.confirm"
}
