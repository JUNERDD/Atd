import AICore
import AIRelay
import CoreFoundation
import Foundation

nonisolated extension DiagnosticsExporter {
  static func encodeMergedDoctorReport(
    shellEvaluation: ShellEnvironmentChecks.Evaluation,
    serviceDoctorJSON: Data?,
    serviceReachable: Bool,
    unavailable: ServiceUnavailable?,
    lastFailure: String?
  ) -> Data? {
    let encoder = JSONEncoder()
    guard let shellChecksData = try? encoder.encode(shellEvaluation.checks),
      let shellArray = (try? JSONSerialization.jsonObject(with: shellChecksData))
        as? [[String: Any]]
    else { return nil }

    let serviceChecks: [[String: Any]] =
      if let svcData = serviceDoctorJSON,
        let svcObj = (try? JSONSerialization.jsonObject(with: svcData)) as? [String: Any],
        let checks = svcObj["checks"] as? [[String: Any]]
      {
        checks
      } else {
        []
      }

    let mergedChecks = mergeDoctorChecksJSON(shellChecks: shellArray, serviceChecks: serviceChecks)

    var passCount = 0
    var warnCount = 0
    var failCount = 0
    var skippedCount = 0
    for check in mergedChecks {
      switch check["status"] as? String {
      case "pass": passCount += 1
      case "warn": warnCount += 1
      case "fail": failCount += 1
      default: skippedCount += 1
      }
    }

    let descriptor = unavailable.map {
      ServiceUnavailableDescriptor.describe($0, lastFailure: lastFailure)
    }
    var root: [String: Any] = [
      "schemaVersion": 1,
      "capturedAt": shellEvaluation.capturedAt,
      "serviceReachable": serviceReachable,
      "summary": [
        "passCount": passCount,
        "warnCount": warnCount,
        "failCount": failCount,
        "skippedCount": skippedCount,
      ],
      "checks": mergedChecks,
    ]
    root["serviceUnavailableCode"] = descriptor?.errorCode ?? NSNull()
    root["serviceUnavailableSummary"] = descriptor?.summary ?? NSNull()
    return try? JSONSerialization.data(withJSONObject: root, options: [.sortedKeys])
  }

  static func mergeDoctorChecksJSON(
    shellChecks: [[String: Any]],
    serviceChecks: [[String: Any]]
  ) -> [[String: Any]] {
    var merged: [[String: Any]] = []
    merged.reserveCapacity(shellChecks.count + serviceChecks.count)
    var indexById: [String: Int] = [:]

    for raw in shellChecks + serviceChecks {
      var check = raw
      check["metrics"] = extractMetricsArray(raw["metrics"])
      guard let id = check["id"] as? String, !id.isEmpty else {
        merged.append(check)
        continue
      }
      if let existingIdx = indexById[id] {
        merged[existingIdx] = reconcileDoctorCheck(existing: merged[existingIdx], incoming: check)
      } else {
        indexById[id] = merged.count
        merged.append(check)
      }
    }
    return merged
  }

  private static func reconcileDoctorCheck(
    existing: [String: Any],
    incoming: [String: Any]
  ) -> [String: Any] {
    let existingRank = severityRank(existing["status"] as? String)
    let incomingRank = severityRank(incoming["status"] as? String)
    let existingHasRem = hasRemediation(existing)
    let incomingHasRem = hasRemediation(incoming)

    let useIncoming: Bool =
      if incomingRank != existingRank {
        incomingRank > existingRank
      } else if existingHasRem != incomingHasRem {
        incomingHasRem
      } else {
        false
      }

    var result = existing
    if useIncoming {
      if let status = incoming["status"] { result["status"] = status }
      if let reasonCode = incoming["reasonCode"] { result["reasonCode"] = reasonCode }
      if incomingHasRem, let rem = incoming["remediation"] {
        result["remediation"] = rem
      } else {
        result.removeValue(forKey: "remediation")
      }
    }

    let existingMetrics = extractMetricsArray(existing["metrics"])
    let incomingMetrics = extractMetricsArray(incoming["metrics"])
    var seenKeys = Set(existingMetrics.compactMap { $0["key"] })
    var combinedMetrics = existingMetrics
    for metric in incomingMetrics {
      if let key = metric["key"], seenKeys.insert(key).inserted {
        combinedMetrics.append(metric)
      }
    }
    result["metrics"] = Array(combinedMetrics.prefix(32))
    result["durationMs"] = max(asDouble(existing["durationMs"]), asDouble(incoming["durationMs"]))
    return result
  }

  private static func severityRank(_ status: String?) -> Int {
    switch status {
    case "fail": 3
    case "warn": 2
    case "pass": 1
    default: 0
    }
  }

  private static func hasRemediation(_ check: [String: Any]) -> Bool {
    guard let rem = check["remediation"] else { return false }
    return !(rem is NSNull)
  }

  private static func asDouble(_ raw: Any?) -> Double {
    if let d = raw as? Double { return d }
    if let n = raw as? NSNumber { return n.doubleValue }
    return 0
  }

  private static func extractMetricsArray(_ raw: Any?) -> [[String: String]] {
    if let array = raw as? [[String: Any]] {
      return array.compactMap { item in
        guard let key = item["key"] as? String else { return nil }
        return ["key": key, "value": stringifyMetricValue(item["value"])]
      }
    }
    if let dict = raw as? [String: Any] {
      return dict.keys.sorted().map { key in
        ["key": key, "value": stringifyMetricValue(dict[key])]
      }
    }
    return []
  }

  private static func stringifyMetricValue(_ raw: Any?) -> String {
    guard let raw, !(raw is NSNull) else { return "" }
    if let str = raw as? String { return str }
    if let num = raw as? NSNumber {
      if CFGetTypeID(num) == CFBooleanGetTypeID() {
        return num.boolValue ? "true" : "false"
      }
      return num.stringValue
    }
    return String(describing: raw)
  }
}
