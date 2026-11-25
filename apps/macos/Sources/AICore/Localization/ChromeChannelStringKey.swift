/// The native copy of Atd for Chrome: the pairing confirmation (D4). The extension's own copy lives
/// in the extension.
public enum ChromeChannelStringKey: String, CaseIterable, ShellCatalogKey {
  case chromePairTitle = "chrome.pair.title"
  /// Four arguments: the profile's label, the browser's name, the browser's developer label, the
  /// 4-character code.
  case chromePairMessage = "chrome.pair.message"
  /// Three arguments: the browser's name, the browser's developer label, the 4-character code (a
  /// profile the browser names nothing for).
  case chromePairMessageUnnamed = "chrome.pair.messageUnnamed"
  case chromePairAllow = "chrome.pair.allow"
}
