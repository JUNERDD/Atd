import Foundation

/// Input rules of the capabilities the shell serves. Messages stay English: they reach the agent
/// through the service, not a native surface.
public enum CapabilityInputs {
  public static let maxSaveBase64Length = 700_000
  public static let maxSaveNameLength = 255
  public static let maxClipboardWriteLength = 1_000_000

  /// A validated `file.save` input.
  public struct FileSave: Equatable, Sendable {
    /// The default name in the save panel: the basename of the requested name.
    public let suggestedName: String
    public let bytes: Data
  }

  public static func fileSave(_ input: JSONValue) -> Result<FileSave, InputError> {
    let name = input.string("name") ?? ""
    let content = input.string("contentBase64") ?? ""
    if name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
      || name.utf16.count > maxSaveNameLength
    {
      return .failure(InputError("Enter a file name."))
    }
    if content.isEmpty || content.utf16.count > maxSaveBase64Length {
      return .failure(
        InputError("The file content is missing or too large to save over the desktop."))
    }
    guard content.utf8.count % 4 == 0, isBase64(content), let bytes = Data(base64Encoded: content)
    else { return .failure(InputError("file.save content is not valid base64.")) }
    return .success(FileSave(suggestedName: AttachmentRules.basename(name), bytes: bytes))
  }

  /// The `file.save` result: name and size only, never the chosen path.
  public static func fileSaved(name: String, size: Int) -> JSONValue {
    .object(["saved": .bool(true), "name": .string(name), "size": .number(Double(size))])
  }

  public static func clipboardWrite(_ input: JSONValue) -> Result<String, InputError> {
    let text = input.string("text") ?? ""
    if text.isEmpty { return .failure(InputError("Nothing to write to the clipboard.")) }
    if text.utf16.count > maxClipboardWriteLength {
      return .failure(InputError("Clipboard content exceeds the limit."))
    }
    return .success(text)
  }

  public struct InputError: Error, Equatable, Sendable {
    public let message: String
    init(_ message: String) { self.message = message }
  }

  /// `/^[A-Za-z0-9+/]*={0,2}$/`
  private static func isBase64(_ text: String) -> Bool {
    let bytes = Array(text.utf8)
    let padding = bytes.reversed().prefix { $0 == UInt8(ascii: "=") }.count
    guard padding <= 2 else { return false }
    return bytes.dropLast(padding).allSatisfy { byte in
      switch byte {
      case UInt8(ascii: "A")...UInt8(ascii: "Z"), UInt8(ascii: "a")...UInt8(ascii: "z"),
        UInt8(ascii: "0")...UInt8(ascii: "9"), UInt8(ascii: "+"), UInt8(ascii: "/"):
        true
      default: false
      }
    }
  }
}

extension JSONValue {
  /// The string member `key` of an object, or nil.
  public func string(_ key: String) -> String? {
    guard case .object(let members) = self, case .string(let value)? = members[key] else {
      return nil
    }
    return value
  }

  /// The boolean member `key` of an object, or nil.
  public func bool(_ key: String) -> Bool? {
    guard case .object(let members) = self, case .bool(let value)? = members[key] else {
      return nil
    }
    return value
  }

  /// The member `key` of an object, or nil.
  public subscript(key: String) -> JSONValue? {
    guard case .object(let members) = self else { return nil }
    return members[key]
  }
}
