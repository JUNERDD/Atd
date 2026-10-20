import AIComputerDriver

// The shell spawns this executable as a direct child and speaks the length-prefixed driver
// protocol over stdin/stdout. All behavior lives in AIComputerDriver; this entry point only
// starts the server loop, which runs until stdin closes (the parent-liveness signal).
runComputerDriver()
