/**
 * Who may reach a `/v1` route. The macOS shell relays renderer (WKWebView) requests only to
 * `renderer` routes; `shell` routes are reachable only by direct main-token clients (the Swift
 * shell and the CLI), never through the relay. Every `/v1` route declares one in its route
 * `config`; the relay receives the resulting manifest at runtime.
 */
export type RouteExposure = 'renderer' | 'shell';

declare module 'fastify' {
  interface FastifyContextConfig {
    exposure?: RouteExposure;
  }
}
