// Atd for Chrome's native messaging host (D3). Chrome starts it for the extension, passing the
// caller origin as the first argument, and speaks the channel's framing on stdin and stdout. The
// host connects to the running shell's unix socket, checks by code signature that the listener is
// its own app (HostListenerCheck), writes one `host.hello`, then pipes frames both ways until
// either side ends (HostMain). It parses nothing else, never starts Atd and never writes a frame
// of its own after the hello: with no shell listening it exits at once and the extension
// reconnects with backoff. Logs go to stderr only; stdout carries Chrome's frames.
HostMain.run(CommandLine.arguments)
