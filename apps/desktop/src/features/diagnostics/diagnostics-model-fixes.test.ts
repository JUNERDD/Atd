import { describe, expect, it } from 'vitest';
import type { DoctorCheckResult } from '@atd/agent-contracts';
import type { ShellDoctorCheck } from '../../client/diagnostics-contract';
import i18n, { changeAppLanguage } from '../../i18n';
import { translateReason } from './diagnostics-labels';
import { mergeDoctorChecks } from './diagnostics-model';

describe('Diagnostics model and localization Bugbot fixes (B7, B25)', () => {
  it('B7: reconciles duplicate net.system_proxy_alignment checks by severity and merges unique metrics', () => {
    const shellCheck: ShellDoctorCheck = {
      id: 'net.system_proxy_alignment',
      layer: 'network_proxy_and_clock',
      status: 'warn',
      reasonCode: 'pac_or_wpad_fallback_to_direct',
      durationMs: 14,
      metrics: [
        { key: 'proxyMode', value: 'pac' },
        { key: 'sharedMetric', value: 'shellValue' },
      ],
      remediation: {
        remediationCode: 'configure_supported_http_proxy',
        action: 'open_external_docs',
      },
    };
    const servicePass: DoctorCheckResult = {
      id: 'net.system_proxy_alignment',
      layer: 'network_proxy_and_clock',
      status: 'pass',
      reasonCode: 'ok',
      durationMs: 29,
      metrics: { sharedMetric: 'serviceValue', skippedBypassCount: 0 },
    };

    const merged = mergeDoctorChecks([shellCheck], [servicePass]);
    expect(merged).toEqual([
      {
        id: 'net.system_proxy_alignment',
        layer: 'network_proxy_and_clock',
        status: 'warn',
        reasonCode: 'pac_or_wpad_fallback_to_direct',
        durationMs: 29,
        metrics: [
          { key: 'proxyMode', value: 'pac' },
          { key: 'sharedMetric', value: 'shellValue' },
          { key: 'skippedBypassCount', value: '0' },
        ],
        remediation: shellCheck.remediation,
      },
    ]);

    const serviceFail: DoctorCheckResult = {
      ...servicePass,
      status: 'fail',
      reasonCode: 'glob_bypass_rules_skipped',
      remediation: {
        remediationCode: 'configure_proxy_and_ca_trust',
        action: 'open_external_docs',
      },
    };
    const escalated = mergeDoctorChecks([shellCheck], [serviceFail]);
    expect(escalated[0]?.status).toBe('fail');
    expect(escalated[0]?.reasonCode).toBe('glob_bypass_rules_skipped');
    expect(escalated[0]?.remediation).toEqual(serviceFail.remediation);

    // On a warn tie without remediation on shell, incoming remediation wins.
    const { remediation: _omitted, ...shellWarnRest } = shellCheck;
    const shellWarnNoRem: ShellDoctorCheck = shellWarnRest;
    const serviceWarn: DoctorCheckResult = {
      ...servicePass,
      status: 'warn',
      reasonCode: 'glob_bypass_rules_skipped',
      remediation: {
        remediationCode: 'configure_proxy_and_ca_trust',
        action: 'open_external_docs',
      },
    };
    const tieWithIncomingRem = mergeDoctorChecks([shellWarnNoRem], [serviceWarn]);
    expect(tieWithIncomingRem[0]?.reasonCode).toBe('glob_bypass_rules_skipped');
    expect(tieWithIncomingRem[0]?.remediation).toEqual(serviceWarn.remediation);
  });

  it('B25: localizes doctor_budget_exceeded in en and zh-CN', async () => {
    const enT = i18n.getFixedT('en', 'diagnostics');
    expect(translateReason(enT, 'doctor_budget_exceeded')).toBe(
      'Diagnostic check timed out before completing.',
    );
    await changeAppLanguage('zh-CN');
    try {
      const zhT = i18n.getFixedT('zh-CN', 'diagnostics');
      expect(translateReason(zhT, 'doctor_budget_exceeded')).toBe('诊断检查超时未能完成。');
    } finally {
      await changeAppLanguage('en');
    }
  });
});
