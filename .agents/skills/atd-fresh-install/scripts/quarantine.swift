import Foundation

guard CommandLine.arguments.count == 2 else {
  fatalError("Usage: quarantine <downloaded-installer.dmg>")
}
var file = URL(fileURLWithPath: CommandLine.arguments[1])
let existing = try file.resourceValues(forKeys: [.quarantinePropertiesKey])
if existing.quarantineProperties == nil {
  var values = URLResourceValues()
  values.quarantineProperties = [
    kLSQuarantineAgentNameKey as String: "Codex",
    kLSQuarantineAgentBundleIdentifierKey as String: "com.openai.codex",
    kLSQuarantineTypeKey as String: kLSQuarantineTypeOtherDownload as String,
  ]
  try file.setResourceValues(values)
}
let written = try file.resourceValues(forKeys: [.quarantinePropertiesKey])
guard written.quarantineProperties != nil else {
  fatalError("Download quarantine could not be verified")
}
print("Download quarantine present")
