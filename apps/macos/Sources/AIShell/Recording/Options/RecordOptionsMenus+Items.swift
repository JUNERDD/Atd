import AICore
import AppKit

/// What the record bar's menus list, built from the current settings each time they show or
/// refresh. Rows that show a value reserve the room of their widest value, so a menu never
/// changes width as values change (the prototype's `P.stable`); a folder name past 160 pt ends
/// in an ellipsis (``ToolbarOptionsRow/maxDetailWidth``), and every row naming a folder shows its
/// full path on hover.
extension RecordOptionsMenus {
  /// No microphone, each connected input, then the system audio switch. A pick shows at once in
  /// the menu, which stays open.
  func soundItems() -> [ToolbarMenuItem] {
    let chosen = microphone?.id
    let none = ToolbarMenuItem(
      content: .init(title: RecordOptionsCopy.text(.microphoneNone), mark: mark(chosen == nil)),
      action: { [weak self] in self?.update { $0.chooseMicrophone(nil) } })
    let devices = microphones.map { device in
      ToolbarMenuItem(
        content: .init(title: device.name, mark: mark(chosen == device.id)),
        action: { [weak self] in self?.update { $0.chooseMicrophone(device.id) } })
    }
    let system = toggle(RecordOptionsCopy.text(.systemAudio), \.systemAudio)
    return [none] + devices + [.separator, system]
  }

  /// The countdown and what the movie shows, its quality and frame rate with the size they make
  /// (a note, which only informs), then what follows the recording.
  func optionItems() -> [ToolbarMenuItem] {
    let copy = RecordOptionsCopy.self
    let estimate = ToolbarMenuItem.note(
      .init(
        title: copy.estimate(megabytesPerMinute: settings.estimatedMegabytesPerMinute),
        reserved: RecordingSettings.allEstimates.map {
          copy.estimate(megabytesPerMinute: $0)
        }), compact: true)
    return [
      choice(
        copy.text(.countdown), \.countdown, RecordingCountdown.allCases,
        name: { copy.countdown($0) }),
      toggle(copy.text(.showPointer), \.showPointer),
      toggle(copy.text(.showClicks), \.showClicks),
      toggle(copy.text(.showKeys), \.showKeys),
      .separator,
      choice(
        copy.text(.quality), \.quality, RecordingQuality.allCases,
        name: { copy.quality($0) }, long: { copy.quality($0, long: true) }),
      choice(
        copy.text(.frameRate), \.frameRate, RecordingFrameRate.allCases,
        name: { copy.frameRate($0) }),
      estimate,
      .separator,
      choice(
        copy.text(.after), \.after, RecordingAfterAction.allCases, name: { copy.after($0) }),
    ]
  }

  /// A row showing `key`'s value, whose submenu lists `values` (each by `long`, the row's value
  /// by `name`) and picks one.
  private func choice<Value: Equatable>(
    _ title: String, _ key: WritableKeyPath<RecordingSettings, Value>, _ values: [Value],
    name: @escaping (Value) -> String, long: ((Value) -> String)? = nil
  ) -> ToolbarMenuItem {
    let current = settings[keyPath: key]
    return ToolbarMenuItem(
      content: .init(
        title: title, detail: name(current), reserved: values.map(name), submenu: true),
      submenu: { [weak self] in
        values.map { value in
          ToolbarMenuItem(
            content: .init(
              title: (long ?? name)(value),
              mark: self?.settings[keyPath: key] == value ? .check : .blank),
            action: { self?.update(closingSubmenu: true) { $0[keyPath: key] = value } })
        }
      })
  }

  /// An on/off row; a click flips it and the menu stays open.
  private func toggle(_ title: String, _ key: WritableKeyPath<RecordingSettings, Bool>)
    -> ToolbarMenuItem
  {
    ToolbarMenuItem(
      content: .init(title: title, mark: mark(settings[keyPath: key]), toggle: true),
      action: { [weak self] in self?.update { $0[keyPath: key].toggle() } })
  }

  private func mark(_ on: Bool) -> ToolbarOptionsRow.Content.Mark {
    on ? .check : .blank
  }
}
