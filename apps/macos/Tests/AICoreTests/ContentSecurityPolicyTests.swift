import Foundation
import Testing

@testable import AICore

@Suite("Renderer CSP and development proxy rules")
struct ContentSecurityPolicyTests {
  private static let vite = DevServerOrigin(URL(string: "http://127.0.0.1:5173")!)!

  @Test("Production allows no inline script, no frames and fetches to the relay only")
  func production() {
    #expect(
      ContentSecurityPolicy.production
        == "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
        + "img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; object-src 'none'; "
        + "base-uri 'self'; form-action 'self'; frame-src 'none'; frame-ancestors 'none'")
  }

  @Test("Development allows the refresh preamble by hash and the HMR socket, nothing inline")
  func development() {
    let policy = ContentSecurityPolicy.development(hmr: Self.vite)
    let directives = Dictionary(
      uniqueKeysWithValues: policy.components(separatedBy: "; ").map { directive in
        let parts = directive.split(separator: " ", maxSplits: 1)
        return (String(parts[0]), String(parts[1]))
      })
    // Computed by Node from `@vitejs/plugin-react` 6.1.1 `preambleCode` with base `/`.
    let preamble = "'sha256-Z2/iFzh9VMlVkEOar1f/oSHWwQk3ve1qk/C2WdsC4Xk='"
    #expect(directives["script-src"] == "'self' \(preamble)")
    #expect(directives["connect-src"] == "'self' ws://127.0.0.1:5173")
    #expect(directives["frame-src"] == "'none'")
    #expect(directives["frame-ancestors"] == "'none'")
    #expect(directives["object-src"] == "'none'")
    #expect(!policy.contains("unsafe-eval"))
    #expect(directives["script-src"]?.contains("unsafe-inline") == false)
  }

  @Test("Hashes an inline script's exact text")
  func hash() {
    #expect(
      ContentSecurityPolicy.hashSource(ofInlineScript: "")
        == "'sha256-47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU='")
  }

  @Test(
    "Accepts only loopback http dev server origins with a port",
    arguments: [
      ("http://127.0.0.1:5173", "ws://127.0.0.1:5173"),
      ("http://localhost:4000/", "ws://localhost:4000"), ("http://[::1]:5173", "ws://[::1]:5173"),
    ])
  func devOrigin(raw: String, webSocket: String) throws {
    let origin = try #require(DevServerOrigin(URL(string: raw)!))
    #expect(origin.webSocketOrigin == webSocket)
  }

  @Test(
    "Refuses remote, secure, pathful or portless dev origins",
    arguments: [
      "https://127.0.0.1:5173", "http://192.168.1.2:5173", "http://127.0.0.1",
      "http://127.0.0.1:5173/app", "http://127.0.0.1:5173/?x=1", "http://u@127.0.0.1:5173",
      "ws://127.0.0.1:5173",
      "http://127.0.0.1.example.com:5173",
    ])
  func devOriginRefused(raw: String) {
    #expect(DevServerOrigin(URL(string: raw)!) == nil)
  }

  @Test(
    "Proxies Vite's module prefixes and ordinary paths",
    arguments: [
      "/", "/src/main.tsx", "/@vite/client", "/@vite/env", "/@react-refresh",
      "/@fs/Users/zen/node_modules/.pnpm/vite@8.3.1_@types+node@24/node_modules/vite/env.mjs",
      "/@id/__x00__virtual", "/node_modules/.vite/deps/react.js",
    ])
  func devPaths(raw: String) throws {
    let path = try RelayPath.normalize(raw)
    #expect(DevProxyRule.check(path, rawQuery: nil) == .success(nil))
  }

  @Test(
    "Refuses other @ prefixes and an empty /@fs/",
    arguments: ["/@vitest/x", "/@fs", "/@react-refresh/x", "/@evil/a", "/@FS/Users/a"])
  func devPrefixRefused(raw: String) throws {
    let path = try RelayPath.normalize(raw)
    #expect(DevProxyRule.check(path, rawQuery: nil) == .failure(.specialPrefix))
  }

  @Test(
    "Forwards the HMR, dependency-version, import and URL-asset queries unchanged",
    arguments: [
      "t=1790680156788", "import", "v=8a1b2C3d", "import&t=12", "t=1&v=abc&import", "",
      "import&url&no-inline", "import&url&no-inline&t=12",
    ])
  func devQueries(query: String) throws {
    let path = try RelayPath.normalize("/src/counter.js")
    #expect(DevProxyRule.check(path, rawQuery: query) == .success(query.isEmpty ? nil : query))
  }

  @Test(
    "Refuses every other query, including Vite's file-disclosure suffixes",
    arguments: [
      "raw", "raw??", "import&raw", "inline", "url", "import&inline", "html-proxy&index=0.js",
      "t=", "t=12a", "t", "v=", "v=../x", "v=a.b", "import=1", "worker", "direct", "t=1&&v=2",
      "t=1&", "T=1", "x-t=1", "url&no-inline", "no-inline", "import&url=1", "import&raw&url",
    ])
  func devQueriesRefused(query: String) throws {
    let path = try RelayPath.normalize("/src/counter.js")
    #expect(DevProxyRule.check(path, rawQuery: query) == .failure(.query))
  }
}
