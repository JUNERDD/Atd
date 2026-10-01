import Foundation

/// The native confirmation of an MCP launch approval, as text. Everything comes from the service's
/// details; the page only named the server.
///
/// `detail` lists one fact per line for a monospaced, read-only view. Every value from a
/// server's configuration is quoted with its control, formatting and separator characters
/// escaped, so a line break or a right-to-left override in a name cannot pass for another line
/// or disguise a path. Env and header values are never shown: a stdio env key comes with its
/// value's length, and an HTTP server lists the names of the service env vars it sends.
public struct McpApprovalDialog: Equatable, Sendable {
  public let title: String
  public let message: String
  public let detail: String

  /// The longest configured value the title and message repeat; `detail` shows it whole.
  static let inlineLimit = 120

  public init(_ details: McpLaunchApprovalDetails, text: ShellText) {
    title = text(.mcpApprovalTitle, Self.inline(details.name))
    var message =
      switch (details.kind, details.http, details.plugin) {
      case (.httpEnv, let http?, _): text(.mcpApprovalMessageHttp, Self.inline(http.url))
      case (_, _, let plugin?):
        text(.mcpApprovalMessagePlugin, Self.inline(plugin.name), Self.inline(plugin.source))
      default: text(.mcpApprovalMessageUser)
      }
    if details.state == .changed { message += "\n\n" + text(.mcpApprovalMessageChanged) }
    self.message = message
    detail = Self.lines(details, text).joined(separator: "\n")
  }

  private static func lines(_ details: McpLaunchApprovalDetails, _ text: ShellText) -> [String] {
    let field = { (key: ShellStringKey, value: String) in
      let label = text(key)
      // A full-width colon already spaces its value.
      return value.isEmpty || label.hasSuffix("：") ? label + value : label + " " + value
    }
    let flag = { (value: String, raised: Bool, key: ShellStringKey) in
      raised ? value + " — " + text(key) : value
    }
    let layer: ShellStringKey =
      details.layer == .plugin ? .mcpApprovalPluginServer : .mcpApprovalUserServer
    var lines = [
      field(.mcpApprovalServer, quoted(details.serverId)), field(.mcpApprovalType, text(layer)),
    ]
    if let plugin = details.plugin {
      let version = plugin.version.map { " " + quoted($0) } ?? ""
      lines.append(field(.mcpApprovalPlugin, quoted(plugin.name) + version))
      lines.append(field(.mcpApprovalSource, quoted(plugin.source)))
      lines.append(field(.mcpApprovalRevision, quoted(plugin.revision)))
    }
    if let stdio = details.stdio {
      lines.append(field(.mcpApprovalCommand, quoted(stdio.command)))
      lines.append(field(.mcpApprovalResolvedCommand, quoted(stdio.resolvedCommand)))
      lines.append(field(.mcpApprovalArguments, list(stdio.args, empty: text(.mcpApprovalNone))))
      lines.append(field(.mcpApprovalWorkingDirectory, quoted(stdio.cwd)))
      let environment: ShellStringKey =
        stdio.inheritEnv
        ? .mcpApprovalEnvironmentInherited
        : stdio.env.isEmpty ? .mcpApprovalNone : .mcpApprovalEnvironmentOnly
      lines.append(field(.mcpApprovalEnvironment, text(environment)))
      for entry in stdio.env {
        let hidden = quoted(entry.key) + " " + text(.mcpApprovalHiddenValue, entry.length)
        lines.append("  " + flag(hidden, entry.risky, .mcpApprovalRisky))
      }
    }
    if let http = details.http {
      lines.append(
        field(.mcpApprovalUrl, flag(quoted(http.url), http.urlReadsEnv, .mcpApprovalReadsEnv)))
      lines.append(field(.mcpApprovalHeaders, http.headers.isEmpty ? text(.mcpApprovalNone) : ""))
      for header in http.headers {
        lines.append("  " + flag(quoted(header.key), header.readsEnv, .mcpApprovalReadsEnv))
      }
      if !http.tokenEnv.isEmpty { lines.append(field(.mcpApprovalTokenEnv, quoted(http.tokenEnv))) }
      let sent = http.sentEnv
      lines.append(
        field(
          .mcpApprovalSentEnv,
          sent.isEmpty ? text(.mcpApprovalNone) : sent.map(quoted).joined(separator: ", ")))
    }
    return lines
  }

  private static func list(_ values: [String], empty: String) -> String {
    values.isEmpty ? empty : "[" + values.map(quoted).joined(separator: ", ") + "]"
  }

  /// `value` in double quotes, with quotes, backslashes and every control, formatting or line
  /// separator character escaped (`\n`, `\u202E`), so it stays on one line and reads as typed.
  static func quoted(_ value: String) -> String {
    var result = "\""
    for scalar in value.unicodeScalars {
      switch scalar {
      case "\"": result += "\\\""
      case "\\": result += "\\\\"
      case "\n": result += "\\n"
      case "\r": result += "\\r"
      case "\t": result += "\\t"
      default:
        if isInvisible(scalar) {
          let hex = String(scalar.value, radix: 16, uppercase: true)
          result += scalar.value > 0xFFFF ? "\\u{\(hex)}" : "\\u" + zeroPadded(hex, to: 4)
        } else {
          result.unicodeScalars.append(scalar)
        }
      }
    }
    return result + "\""
  }

  /// `value` for a sentence: invisible formatting removed, line breaks and other controls made
  /// spaces, and cut at ``inlineLimit`` characters.
  static func inline(_ value: String) -> String {
    var scalars = String.UnicodeScalarView()
    for scalar in value.unicodeScalars where scalar.properties.generalCategory != .format {
      scalars.append(isInvisible(scalar) ? " " : scalar)
    }
    let flat = String(scalars)
    return flat.count > inlineLimit ? flat.prefix(inlineLimit - 1) + "…" : flat
  }

  private static func isInvisible(_ scalar: Unicode.Scalar) -> Bool {
    switch scalar.properties.generalCategory {
    case .control, .format, .lineSeparator, .paragraphSeparator: true
    default: false
    }
  }

  private static func zeroPadded(_ hex: String, to width: Int) -> String {
    String(repeating: "0", count: max(0, width - hex.count)) + hex
  }
}
