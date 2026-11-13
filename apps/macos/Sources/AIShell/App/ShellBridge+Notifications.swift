import AICore

/// Notification preference and system-settings bridge calls (`notifications.*`).
extension ShellBridge {
  static func notificationsState(shell: ShellController) async throws(BridgeError) -> JSONValue {
    try Self.encode(await Self.notifications(of: shell).state())
  }

  static func setNotifications(_ params: NotificationsSetParams, shell: ShellController)
    async throws(BridgeError) -> JSONValue
  {
    try Self.encode(await Self.notifications(of: shell).apply(params))
  }

  static func openNotificationSettings(shell: ShellController) throws(BridgeError) -> JSONValue {
    try Self.notifications(of: shell).openSystemSettings()
    return try Self.encode(NativeEmpty())
  }

  /// Notifications exist only in an app bundle.
  private static func notifications(of shell: ShellController) throws(BridgeError)
    -> ShellNotifications
  {
    guard let notifications = shell.notifications else {
      throw BridgeError("Notifications are unavailable outside the app.")
    }
    return notifications
  }
}
