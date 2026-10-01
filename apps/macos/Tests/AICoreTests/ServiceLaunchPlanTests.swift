import Foundation
import Testing

@testable import AICore

@Suite("Service launch plan and artifact names")
struct ServiceLaunchPlanTests {
  private static let plan = ServiceLaunchPlan(
    resources: URL(fileURLWithPath: "/Applications/AI.app/Contents/Resources", isDirectory: true),
    dataDirectory: URL(
      fileURLWithPath: "/Users/u/Library/Application Support/AgentService", isDirectory: true))

  @Test("Runs the bundled Node and service by absolute path with the login-shell flag")
  func arguments() {
    #expect(Self.plan.node.path == "/Applications/AI.app/Contents/Resources/node/bin/node")
    #expect(
      Self.plan.arguments == [
        "/Applications/AI.app/Contents/Resources/agent-service/dist/cli.js", "serve", "--dataDir",
        "/Users/u/Library/Application Support/AgentService", "--login-shell-path",
      ])
  }

  @Test("Appends the bundled Node's directory to PATH once and drops the data-dir override")
  func environment() {
    let bin = "/Applications/AI.app/Contents/Resources/node/bin"
    let environment = Self.plan.environment(inheriting: [
      "PATH": "/usr/bin:\(bin):/bin", "AI_AGENT_DATA_DIR": "/elsewhere", "HOME": "/Users/u",
    ])
    #expect(environment["PATH"] == "/usr/bin:/bin:\(bin)")
    #expect(environment["AI_AGENT_DATA_DIR"] == nil)
    #expect(environment["HOME"] == "/Users/u")
    #expect(Self.plan.environment(inheriting: [:])["PATH"] == bin)
  }

  @Test("Reuses a running service only for the same known build")
  func reuse() {
    #expect(ServiceLaunchPlan.canReuse(running: "b1", bundled: "b1"))
    #expect(!ServiceLaunchPlan.canReuse(running: "b1", bundled: "b2"))
    #expect(!ServiceLaunchPlan.canReuse(running: nil, bundled: "b1"))
    #expect(!ServiceLaunchPlan.canReuse(running: "b1", bundled: nil))
    #expect(!ServiceLaunchPlan.canReuse(running: nil, bundled: nil))
    #expect(ServiceLaunchPlan.parseBuildInfo(Data(#"{"version":1,"buildId":"b7"}"#.utf8)) == "b7")
    #expect(ServiceLaunchPlan.parseBuildInfo(Data(#"{"version":2,"buildId":"b7"}"#.utf8)) == nil)
    #expect(ServiceLaunchPlan.parseBuildInfo(Data(#"{"version":1,"buildId":""}"#.utf8)) == nil)
  }

  @Test("Rotates service.log into four previous launches, oldest first")
  func rotation() {
    let renames = ServiceLogRotation.renames().map { "\($0.from)>\($0.to)" }
    #expect(
      renames == [
        "service.3.log>service.4.log", "service.2.log>service.3.log", "service.1.log>service.2.log",
        "service.log>service.1.log",
      ])
  }

  @Test("Reads download names from Content-Disposition like the JS client")
  func disposition() {
    #expect(ArtifactFileName.fromDisposition(nil) == "download.bin")
    #expect(ArtifactFileName.fromDisposition(#"attachment; filename="a b.pdf""#) == "a b.pdf")
    #expect(
      ArtifactFileName.fromDisposition(
        #"attachment; filename="x.txt"; filename*=UTF-8''%E6%8A%A5%E5%91%8A.md"#) == "报告.md")
    #expect(ArtifactFileName.fromDisposition("FILENAME*=utf-8''r%C3%A9.txt") == "ré.txt")
    #expect(ArtifactFileName.fromDisposition("attachment") == "download.bin")
  }

  @Test("Makes names safe as one file-name component")
  func safeNames() {
    #expect(ArtifactFileName.safe("../../etc/passwd") == ".._.._etc_passwd")
    #expect(ArtifactFileName.safe("a:b|c?.txt") == "a_b_c_.txt")
    #expect(ArtifactFileName.safe("") == "download.bin")
    #expect(ArtifactFileName.safe("..") == "download.bin")
    #expect(ArtifactFileName.safe(String(repeating: "x", count: 300)).count == 200)
    #expect(ArtifactFileName.downloadName(artifactId: "res_1", name: "a/b.txt") == "res_1-a_b.txt")
  }
}
