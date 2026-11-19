import type { DoctorRunResponse, LiveProbeKind } from '@atd/agent-contracts';
import type { CallResult, EventPayload } from '../native-bridge/client';

export type ShellDoctorReport = CallResult<'diagnostics.shellReport'>;
export type ShellDoctorCheck = ShellDoctorReport['checks'][number];
export type DecisionRingSummary = ShellDoctorReport['rings'][number];
export type LiveProbeStartResult = CallResult<'diagnostics.liveProbe.start'>;
export type LiveProbeEvent = EventPayload<'diagnostics.liveProbe.event'>;
export type BundlePreviewResult = CallResult<'diagnostics.previewBundle'>;
export type BundlePreviewFile = BundlePreviewResult['files'][number];
export type BundleExportResult = CallResult<'diagnostics.exportBundle'>;
export type RestartServiceResult = CallResult<'diagnostics.restartService'>;

/** Desktop diagnostics surface spanning the Swift shell bridge and `POST /v1/diagnostics/run`. */
export interface DiagnosticsBridge {
  runDoctor: (includeConnectivity?: boolean) => Promise<DoctorRunResponse>;
  shellReport: () => Promise<ShellDoctorReport>;
  startLiveProbe: (kind: LiveProbeKind) => Promise<LiveProbeStartResult>;
  stopLiveProbe: () => Promise<void>;
  onLiveProbeEvent: (listener: (event: LiveProbeEvent) => void) => () => void;
  previewBundle: (includeCrashSummaries: boolean) => Promise<BundlePreviewResult>;
  exportBundle: (includeCrashSummaries: boolean) => Promise<BundleExportResult>;
  restartService: () => Promise<RestartServiceResult>;
}
