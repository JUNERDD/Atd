import AtdAI
import AtdModel
import AtdPinyin
import Foundation

/// What the keyboard reads and keeps. With Full Access it reads the library, the phrases and the
/// settings from the App Group, and reports itself there so the app can show it as set up.
/// Without Full Access the system keeps it out of the group, and it types from its own container:
/// the phrases copied there last time (the built-in ones on a fresh install) and what the pinyin
/// engine learned, which never leaves that container.
final class KeyboardData {
  let group = AppGroup.current()
  /// The keyboard's own container.
  private let local: SharedStore
  private let defaults = UserDefaults.standard
  private static let seenKey = "seenChangeCount"

  struct Shared {
    var commands: [Command] = []
    var phrases: [Phrase]
    var hasModel = false
  }

  init() {
    let support = URL.applicationSupportDirectory.appending(
      path: "Atd", directoryHint: .isDirectory)
    local = SharedStore(directory: support, notificationName: nil)
  }

  /// The App Group's store, when the keyboard has Full Access and the group is reachable.
  private func store(fullAccess: Bool) -> SharedStore? {
    guard fullAccess, let group else { return nil }
    return SharedStore.appGroup(group)
  }

  func load(fullAccess: Bool) -> Shared {
    guard let store = store(fullAccess: fullAccess) else {
      return Shared(phrases: local.load(PhraseBook.self).document.phrases)
    }
    let phrases = store.load(PhraseBook.self).document
    // The copy the keyboard types with when Full Access is off.
    _ = try? local.update(PhraseBook.self) { $0 = phrases }
    return Shared(
      commands: store.load(CommandLibrary.self).document.keyboardCommands,
      phrases: phrases.phrases,
      hasModel: store.load(AppSettings.self).document.defaultConnection != nil)
  }

  /// Tells the app the keyboard is set up and has Full Access (it can only write with it).
  func reportSeen(fullAccess: Bool) {
    guard let store = store(fullAccess: fullAccess) else { return }
    let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String
    _ = try? store.update(KeyboardStatus.self) {
      $0 = KeyboardStatus(version: version ?? "", lastSeen: .now)
    }
  }

  /// Remembers an option value chosen in the options panel, as the 指令 tab does.
  func setValue(_ value: String, for key: String, in commandID: String, fullAccess: Bool) {
    _ = try? store(fullAccess: fullAccess)?.update(CommandLibrary.self) {
      $0.setValue(value, for: key, in: commandID)
    }
  }

  /// Requests go to the connection the settings name at the time of each request.
  var generator: ModelRunner {
    let group = group
    return ModelRunner(settings: {
      guard let group, let store = SharedStore.appGroup(group) else { return .initial() }
      return store.load(AppSettings.self).document
    })
  }

  // MARK: Kept in the keyboard's own container

  private var dictionaryURL: URL {
    local.directory.appending(path: "user-dictionary.json", directoryHint: .notDirectory)
  }

  func engine() -> PinyinEngine {
    let lexicon: Lexicon
    do {
      lexicon = try Lexicon.bundled()
    } catch {
      // The lexicon ships inside the extension; without it the build itself is broken.
      fatalError("The pinyin lexicon is missing from the keyboard: \(error)")
    }
    let saved = (try? Data(contentsOf: dictionaryURL)).flatMap {
      try? JSONDecoder().decode(UserDictionary.self, from: $0)
    }
    return PinyinEngine(lexicon: lexicon, userDictionary: saved ?? UserDictionary())
  }

  func save(_ dictionary: UserDictionary) {
    guard let data = try? JSONEncoder().encode(dictionary) else { return }
    try? FileManager.default.createDirectory(at: local.directory, withIntermediateDirectories: true)
    try? data.write(
      to: dictionaryURL, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
  }

  /// The pasteboard change count the keyboard last acted on, so a copy is new only once.
  var seenChangeCount: Int? {
    get { defaults.object(forKey: Self.seenKey) as? Int }
    set { defaults.set(newValue, forKey: Self.seenKey) }
  }
}
