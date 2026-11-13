/// Screenshot local-save copy (`capture.save.*`): toolbar action, ellipsis save prompt label,
/// the folder picker prompt, and the save failure status.
public enum ScreenshotSaveStringKey: String, CaseIterable, Sendable, ShellCatalogKey {
  case toolbarSave = "capture.save"
  case saveEllipsis = "capture.save.ellipsis"
  case saveFailed = "capture.save.failed"
  case folderPickerMessage = "capture.save.folder.message"
}
