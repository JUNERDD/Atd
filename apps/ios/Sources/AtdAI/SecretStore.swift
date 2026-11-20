import Foundation
import Security

/// Where provider keys live, one per connection. The app writes them; the keyboard reads them
/// when it has Full Access.
public protocol SecretStoring: Sendable {
  /// The key stored for `connectionID`, or nil when there is none.
  func key(for connectionID: String) throws -> String?
  func setKey(_ key: String, for connectionID: String) throws
  func removeKey(for connectionID: String) throws
}

/// Keys in the Keychain: a generic password per connection, readable after the first unlock and
/// on this device only, so a key never reaches iCloud Keychain or a backup.
///
/// No access group is named: items land in the first `keychain-access-groups` entry, the group
/// the app and the keyboard share (on a simulator build without a team, the app's own group).
public struct KeychainSecretStore: SecretStoring {
  public static let providerService = "com.junerdd.atd.provider"

  /// The Keychain service the items are filed under.
  public let service: String

  public init(service: String = providerService) {
    self.service = service
  }

  public func key(for connectionID: String) throws -> String? {
    var query = itemQuery(connectionID)
    query[kSecReturnData as String] = true
    query[kSecMatchLimit as String] = kSecMatchLimitOne
    var result: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &result)
    switch status {
    case errSecSuccess:
      guard let data = result as? Data else { throw KeychainError(status: errSecDecode) }
      return String(decoding: data, as: UTF8.self)
    case errSecItemNotFound:
      return nil
    default:
      throw KeychainError(status: status)
    }
  }

  public func setKey(_ key: String, for connectionID: String) throws {
    let attributes: [String: Any] = [
      kSecValueData as String: Data(key.utf8),
      kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
    ]
    let query = itemQuery(connectionID)
    var status = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
    if status == errSecItemNotFound {
      status = SecItemAdd(query.merging(attributes) { $1 } as CFDictionary, nil)
    }
    guard status == errSecSuccess else { throw KeychainError(status: status) }
  }

  public func removeKey(for connectionID: String) throws {
    let status = SecItemDelete(itemQuery(connectionID) as CFDictionary)
    guard status == errSecSuccess || status == errSecItemNotFound else {
      throw KeychainError(status: status)
    }
  }

  private func itemQuery(_ connectionID: String) -> [String: Any] {
    [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: connectionID,
    ]
  }
}

/// A Keychain call that failed, with its `OSStatus`.
public struct KeychainError: Error, Equatable {
  public var status: OSStatus
}
