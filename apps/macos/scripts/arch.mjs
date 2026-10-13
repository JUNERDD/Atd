/**
 * The architectures the native app ships for, by their Node and artifact name (`arm64`, `x64`),
 * mapped to the Xcode and Mach-O name (`arm64`, `x86_64`). The build, the service pack and its
 * verification all take a Node name and translate it here.
 */
import { spawnSync } from 'node:child_process';

export const MACHO_ARCHS = Object.freeze({ arm64: 'arm64', x64: 'x86_64' });

/** The Node name of a Mach-O architecture, or undefined for one the app does not ship. */
export function nodeArchOf(machOArch) {
  return Object.keys(MACHO_ARCHS).find((arch) => MACHO_ARCHS[arch] === machOArch);
}

/**
 * The architecture this Mac runs natively, whatever architecture the calling Node runs as:
 * `hw.optional.arm64` stays 1 under Rosetta. Throws on other platforms and architectures.
 */
export function nativeHostArch() {
  if (process.platform !== 'darwin')
    throw new Error(`the native app builds on macOS only, not ${process.platform}.`);
  const probe = spawnSync('sysctl', ['-n', 'hw.optional.arm64'], { encoding: 'utf8' });
  if (probe.stdout?.trim() === '1') return 'arm64';
  if (process.arch === 'x64') return 'x64';
  throw new Error(
    `unsupported macOS architecture ${process.arch}; the app builds for arm64 or x64.`,
  );
}
