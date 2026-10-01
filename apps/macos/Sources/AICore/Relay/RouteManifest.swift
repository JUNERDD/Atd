import Foundation

/// The service's route classification, fetched from `GET /v1/admin/routes` with the main
/// token. It is only ever used whole: a manifest that fails to decode or compile denies every
/// relayed request (fail closed).
public struct RouteManifest: Codable, Equatable, Sendable {
  /// The service epoch the manifest belongs to; relayed requests carry it back as a
  /// precondition (``RelayPolicy/epochHeader``).
  public var epoch: Int
  public var routes: [Route]

  public init(epoch: Int, routes: [Route]) {
    self.epoch = epoch
    self.routes = routes
  }

  public struct Route: Codable, Equatable, Sendable {
    /// Upper-case HTTP method, compared exactly.
    public var method: String
    /// Fastify syntax: literal segments and whole-segment `:name` parameters only.
    public var pathPattern: String
    public var exposure: Exposure

    public init(method: String, pathPattern: String, exposure: Exposure) {
      self.method = method
      self.pathPattern = pathPattern
      self.exposure = exposure
    }
  }

  /// `renderer` routes may pass the relay; `shell` routes are for the shell's own direct calls.
  /// An unknown value fails decoding, so a newer service cannot widen the relay silently.
  public enum Exposure: String, Codable, Sendable {
    case renderer
    case shell
  }

  public static func decode(_ data: Data) throws -> RouteManifest {
    try JSONDecoder().decode(RouteManifest.self, from: data)
  }
}

/// Why a manifest was refused as a whole.
public enum RouteManifestError: Error, Equatable, Sendable {
  case negativeEpoch
  /// The pattern uses syntax outside the v1 contract (wildcards, regex or partial-segment
  /// parameters, escaped colons) or is not absolute. Its precedence against the other routes
  /// cannot be reproduced, so no route of the manifest is trusted.
  case unsupportedPattern(String)
}

/// Why the relay refused a request that passed normalization. Both answer 403.
public enum RouteDenial: Equatable, Sendable {
  /// No route of the manifest takes this method and path.
  case unmatched
  /// The route the service would dispatch to is `shell`-only, or two routes of different
  /// exposure tie for it.
  case shellOnly
}

public enum RouteDecision: Equatable, Sendable {
  case allow
  case deny(RouteDenial)
}

/// Default-deny allow-list over a compiled manifest. It reproduces the service router's choice
/// (find-my-way): among routes of the request's method whose shape matches, a literal segment
/// outranks a parameter at the first position where they differ. Allowing on "some renderer
/// route matches" would be wrong: `GET /v1/:kind/routes` (renderer) must not open
/// `GET /v1/admin/routes` (shell), which the service dispatches to the literal route.
public struct RouteMatcher: Sendable {
  public let epoch: Int
  private let routes: [CompiledRoute]

  public init(manifest: RouteManifest) throws(RouteManifestError) {
    guard manifest.epoch >= 0 else { throw .negativeEpoch }
    var compiled: [CompiledRoute] = []
    for route in manifest.routes {
      compiled.append(
        CompiledRoute(
          method: route.method, segments: try Self.compile(route.pathPattern),
          exposure: route.exposure))
    }
    epoch = manifest.epoch
    routes = compiled
  }

  public func decide(method: String, path: NormalizedPath) -> RouteDecision {
    let candidates = routes.filter { $0.method == method && $0.matches(path.segments) }
    guard let best = candidates.max(by: { $0.ranks(below: $1) }) else {
      return .deny(.unmatched)
    }
    let tied = candidates.filter { !$0.ranks(below: best) }
    return tied.allSatisfy { $0.exposure == .renderer } ? .allow : .deny(.shellOnly)
  }

  private static func compile(_ pattern: String) throws(RouteManifestError) -> [PatternSegment] {
    guard pattern.hasPrefix("/") else { throw .unsupportedPattern(pattern) }
    if pattern == "/" { return [] }
    var segments: [PatternSegment] = []
    for part in pattern.dropFirst().split(separator: "/", omittingEmptySubsequences: false) {
      if part.contains("*") || part.contains("(") || part.contains("?") {
        throw .unsupportedPattern(pattern)
      }
      if part.first == ":" {
        let name = part.dropFirst()
        let valid =
          !name.isEmpty && name.unicodeScalars.allSatisfy { $0 == "_" || $0.isASCIIAlphanumeric }
        guard valid else { throw .unsupportedPattern(pattern) }
        segments.append(.parameter)
      } else {
        guard !part.contains(":") else { throw .unsupportedPattern(pattern) }
        // An empty literal (a trailing slash) is kept: normalized paths never have empty
        // segments, so such a route simply never matches.
        segments.append(.literal(String(part)))
      }
    }
    return segments
  }
}

private enum PatternSegment: Equatable, Sendable {
  case literal(String)
  /// Matches exactly one non-empty segment; normalization guarantees it holds no `/`.
  case parameter
}

private struct CompiledRoute: Sendable {
  let method: String
  let segments: [PatternSegment]
  let exposure: RouteManifest.Exposure

  func matches(_ path: [String]) -> Bool {
    guard path.count == segments.count else { return false }
    return zip(segments, path).allSatisfy { pattern, value in
      if case .literal(let literal) = pattern { return literal == value }
      return true
    }
  }

  /// Router precedence between two routes matching the same path: at the first differing
  /// segment kind, the literal wins.
  func ranks(below other: CompiledRoute) -> Bool {
    for (mine, theirs) in zip(segments, other.segments) {
      switch (mine, theirs) {
      case (.parameter, .literal): return true
      case (.literal, .parameter): return false
      default: continue
      }
    }
    return false
  }
}

extension Unicode.Scalar {
  fileprivate var isASCIIAlphanumeric: Bool {
    switch value {
    case 0x30...0x39, 0x41...0x5A, 0x61...0x7A: true
    default: false
    }
  }
}
