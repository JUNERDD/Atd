/*
 * Adapted from pi-hermes-memory 0.9.9 (MIT, © 2025 Chandra Teja): src/store/content-scanner.ts.
 * Changes: zh-CN injection phrases beside the English ones; the unused `scanSecrets` is left out.
 *
 * Copyright (c) 2025 Chandra Teja
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy of this software
 * and associated documentation files (the "Software"), to deal in the Software without
 * restriction, including without limitation the rights to use, copy, modify, merge, publish,
 * distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the
 * Software is furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all copies or
 * substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING
 * BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
 * NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
 * DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
 */

/**
 * Blocks prompt injection, exfiltration and secrets in text that will reach a model later: every
 * memory write and every Personal skill created from a memory suggestion pass it. Memory is
 * context, never instructions, and it is never a place for credentials.
 */
const MEMORY_THREAT_PATTERNS: Array<{ pattern: RegExp; id: string }> = [
  { pattern: /ignore\s+(previous|all|above|prior)\s+instructions/i, id: 'prompt_injection' },
  { pattern: /you\s+are\s+now\s+/i, id: 'role_hijack' },
  { pattern: /do\s+not\s+tell\s+the\s+user/i, id: 'deception_hide' },
  { pattern: /system\s+prompt\s+override/i, id: 'sys_prompt_override' },
  {
    pattern: /disregard\s+(your|all|any)\s+(instructions|rules|guidelines)/i,
    id: 'disregard_rules',
  },
  {
    pattern:
      /act\s+as\s+(if|though)\s+you\s+(have\s+no|don'?t\s+have)\s+(restrictions|limits|rules)/i,
    id: 'bypass_restrictions',
  },
  { pattern: /curl\s+[^\n]*\$\{?\w*(KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|API)/i, id: 'exfil_curl' },
  { pattern: /wget\s+[^\n]*\$\{?\w*(KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|API)/i, id: 'exfil_wget' },
  {
    pattern: /cat\s+[^\n]*(\.env|credentials|\.netrc|\.pgpass|\.npmrc|\.pypirc)/i,
    id: 'read_secrets',
  },
  { pattern: /authorized_keys/i, id: 'ssh_backdoor' },
  { pattern: /\$HOME\/\.ssh|~\/\.ssh/i, id: 'ssh_access' },
  // zh-CN counterparts of the injection phrases above.
  {
    pattern:
      /(忽略|无视|忽视)(之前|先前|以上|上面|前面|上述|所有)的?(所有|全部)?(指令|指示|提示|说明|规则)/,
    id: 'prompt_injection',
  },
  {
    pattern: /从现在(开始|起)你(是|就是|扮演)|你现在(扮演|的身份是|是一[个名位])/,
    id: 'role_hijack',
  },
  { pattern: /(不要|别|不准|不许|切勿)(告诉|告知|透露给)用户/, id: 'deception_hide' },
  { pattern: /系统提示词?覆盖|覆盖系统提示/, id: 'sys_prompt_override' },
  {
    pattern: /(无视|违背|不要遵守|不用遵守|不必遵守)(你的|所有|任何)(指令|规则|准则)/,
    id: 'disregard_rules',
  },
  { pattern: /(假装|就当|当作)你(没有|不受)(任何)?(限制|约束|规则)/, id: 'bypass_restrictions' },
];

/**
 * Credentials, keys, tokens and the environment variables that usually hold them. Ported from
 * pk-pi-hermes-evolve engine.ts `scanForSecrets()` by the original author.
 */
const SECRET_PATTERNS: Array<{ pattern: RegExp; id: string; severity: 'high' | 'medium' }> = [
  // API keys
  { pattern: /\bsk-ant-api\S{10,}\b/, id: 'anthropic_api_key', severity: 'high' },
  { pattern: /\bsk-or-v1-\S{10,}\b/, id: 'openrouter_api_key', severity: 'high' },
  { pattern: /\bsk-\S{20,}\b/, id: 'openai_api_key', severity: 'high' },
  { pattern: /\bAKIA[0-9A-Z]{16}\b/, id: 'aws_access_key', severity: 'high' },
  // Tokens
  { pattern: /\bghp_\S{10,}\b/, id: 'github_personal_token', severity: 'high' },
  { pattern: /\bghu_\S{10,}\b/, id: 'github_user_token', severity: 'high' },
  { pattern: /\bxoxb-\S{10,}\b/, id: 'slack_bot_token', severity: 'high' },
  { pattern: /\bxapp-\S{10,}\b/, id: 'slack_app_token', severity: 'high' },
  { pattern: /\bntn_\S{10,}\b/, id: 'notion_token', severity: 'high' },
  { pattern: /\bBearer\s+\S{20,}\b/, id: 'bearer_auth_token', severity: 'high' },
  // SSH keys
  {
    pattern: /-----BEGIN\s+(?:RSA\s+)?PRIVATE\sKEY-----/,
    id: 'private_key_block',
    severity: 'high',
  },
  // Environment variable names that indicate secrets
  { pattern: /\bANTHROPIC_API_KEY\b/, id: 'env_anthropic_key', severity: 'medium' },
  { pattern: /\bOPENAI_API_KEY\b/, id: 'env_openai_key', severity: 'medium' },
  { pattern: /\bOPENROUTER_API_KEY\b/, id: 'env_openrouter_key', severity: 'medium' },
  { pattern: /\bGITHUB_TOKEN\b/, id: 'env_github_token', severity: 'medium' },
  { pattern: /\bAWS_SECRET_ACCESS_KEY\b/, id: 'env_aws_secret', severity: 'medium' },
  { pattern: /\bDATABASE_URL\b/, id: 'env_database_url', severity: 'medium' },
  // Inline secret assignments (likely accidental paste)
  { pattern: /\bpassword\s*[=:]\s*\S{6,}\b/i, id: 'password_assignment', severity: 'medium' },
  { pattern: /\bsecret\s*[=:]\s*\S{6,}\b/i, id: 'secret_assignment', severity: 'medium' },
  { pattern: /\btoken\s*[=:]\s*\S{10,}\b/i, id: 'token_assignment', severity: 'medium' },
];

const INVISIBLE_CHARS = new Set([
  '\u200b',
  '\u200c',
  '\u200d',
  '\u2060',
  '\ufeff',
  '\u202a',
  '\u202b',
  '\u202c',
  '\u202d',
  '\u202e',
]);

/**
 * Scans text for injection or exfiltration patterns and secret leaks. Answers why it is blocked,
 * or null when it is safe to store.
 */
export function scanContent(content: string): string | null {
  for (const char of content) {
    if (INVISIBLE_CHARS.has(char)) {
      return `Blocked: content contains invisible unicode character U+${char.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')} (possible injection).`;
    }
  }
  for (const { pattern, id } of MEMORY_THREAT_PATTERNS) {
    if (pattern.test(content)) {
      return `Blocked: content matches threat pattern '${id}'. Memory reaches the agent's context, so it must not contain injection or exfiltration payloads.`;
    }
  }
  for (const { pattern, id, severity } of SECRET_PATTERNS) {
    if (pattern.test(content)) {
      return `Blocked: content looks like a ${severity}-severity credential or secret ('${id}'). Never persist API keys, tokens, or passwords to memory. Use an .env file or secrets manager instead.`;
    }
  }
  return null;
}
