/**
 * Why preparing an app's declared npm packages failed. Each code names one cause the agent can act
 * on (choose another package, add its types, fix a name, wait for the network); `detail` keeps
 * npm's own explanation for the app's diagnostics.
 */
export type DependencyErrorCode =
  /** A provided, toolchain or `@atd` package, declared or pulled in by another package. */
  | 'dependency_not_allowed'
  /** No package of that name on the registry (npm E404). */
  | 'dependency_not_found'
  /** No release matches the range among those old enough (npm ETARGET). */
  | 'dependency_no_version'
  /** Peer requirements conflict, typically with Atd's React (npm ERESOLVE). */
  | 'dependency_conflict'
  /** A package that would run an install script. */
  | 'dependency_install_script'
  /** A package from outside the npm registry, or without an sha512 integrity. */
  | 'dependency_source'
  /** A package that ships native code (a `.node` addon or a Mach-O binary). */
  | 'dependency_native_code'
  /** Package CSS with a Tailwind directive that loads code or reads other paths. */
  | 'dependency_css_directive'
  /** Too many packages, files or bytes. */
  | 'dependency_too_large'
  /** The registry could not be reached, or npm's cache lacked a package while offline. */
  | 'dependency_offline'
  /** A download did not match its recorded checksum (npm EINTEGRITY). */
  | 'dependency_integrity'
  | 'dependency_timeout'
  /** Anything else npm or the installer reported. */
  | 'dependency_failed';

export interface DependencyError {
  code: DependencyErrorCode;
  message: string;
  /** The app file the error is about (`atd-app.json` for a refused declaration). */
  file?: string;
  /** npm's explanation or output, for diagnostics; never shown as the error itself. */
  detail?: string;
}

/** Thrown by the preparation steps; `prepareDependencies` answers its errors. */
export class DependencyFailure extends Error {
  constructor(readonly errors: DependencyError[]) {
    super(errors.map((error) => error.message).join('\n'));
  }
}

/** A failure with one error. */
export function dependencyFailure(
  code: DependencyErrorCode,
  message: string,
  detail?: string,
): DependencyFailure {
  return new DependencyFailure([detail ? { code, message, detail } : { code, message }]);
}
