import { LoginFailure } from './login-errors.js';
import * as oidc from 'openid-client';
import type { OAuthAuth } from '@earendil-works/pi-ai';
import { parse } from '@atd/agent-contracts';
import { oauthCallback } from './oauth-callback.js';
import type { ChatGPTLoginOptions } from './oauth-callback.js';
import { oauthOperation } from './oauth-errors.js';
import { terminalChatGPTRefreshError } from './chatgpt-refresh-error.js';
import {
  chatgptHostId,
  ChatGPTCredentialSchema,
  ChatGPTRegistrationStore,
  type ChatGPTCredential,
  type ChatGPTRegistration,
} from './chatgpt-storage.js';

export const CHATGPT_RESOURCE = 'https://api.openai.com/v1';
const ISSUER = 'https://auth.openai.com';
const DIRECT_SCOPE = 'chatgpt.tokens.use.direct';
const SCOPE = `openid profile email offline_access resource.invoke ${DIRECT_SCOPE}`;

async function configuration(clientId: string, signal: AbortSignal) {
  return oauthOperation('discovery', () =>
    oidc.discovery(new URL(ISSUER), clientId, undefined, oidc.None(), {
      timeout: 15,
      execute: [oidc.enableNonRepudiationChecks],
      [oidc.customFetch]: (url, { body, ...options }) =>
        fetch(url, {
          ...options,
          ...(body === undefined ? {} : { body }),
          signal: AbortSignal.any([signal, options.signal ?? AbortSignal.timeout(15000)]),
        }),
    }),
  );
}

type Tokens = Awaited<ReturnType<typeof oidc.authorizationCodeGrant>>;

function credentialFrom(
  tokens: Tokens,
  registration: ChatGPTRegistration,
  previous?: ChatGPTCredential,
): ChatGPTCredential {
  const identity = tokens.claims();
  const subject = identity?.sub ?? previous?.subject;
  if (!subject || (registration.subject && subject !== registration.subject))
    throw new LoginFailure(
      'The signed-in ChatGPT account does not match this connection. Add another connection.',
    );
  const scopes = tokens.scope?.split(/\s+/).filter(Boolean) ?? previous?.scopes ?? [];
  if (!tokens.expires_in || tokens.expires_in <= 0)
    throw new LoginFailure('ChatGPT returned an invalid token expiry. Sign in again.');
  return parse(ChatGPTCredentialSchema, {
    type: 'oauth',
    protocol: 'siwc',
    clientId: registration.clientId,
    subject,
    ...(typeof identity?.email === 'string'
      ? { email: identity.email }
      : previous?.email
        ? { email: previous.email }
        : {}),
    access: tokens.access_token,
    refresh: tokens.refresh_token ?? previous?.refresh,
    expires: Date.now() + tokens.expires_in * 1000,
    idToken: tokens.id_token ?? previous?.idToken,
    scopes,
  });
}

/** SIWC uses an app registration and verified OIDC identity, never a Codex client's identity. */
export function chatgptOAuth(
  dataDir: string,
  connectionId: string,
  options?: ChatGPTLoginOptions,
): OAuthAuth {
  const registrations = new ChatGPTRegistrationStore(dataDir, connectionId);
  return {
    name: 'ChatGPT',
    isSubscription: true,
    loginLabel: 'Continue with ChatGPT',
    async login(interaction) {
      const signal = interaction.signal;
      const registration = await registrations.read();
      const hostId = await chatgptHostId(dataDir);
      const config = await configuration(registration?.clientId ?? 'dynamic_agent_client', signal);
      const state = oidc.randomState();
      const nonce = oidc.randomNonce();
      const verifier = oidc.randomPKCECodeVerifier();
      const callback = await oauthCallback(state, signal, options?.language);
      options?.onCallback?.(callback);
      try {
        const url = oidc.buildAuthorizationUrl(config, {
          ...(!registration ? { agent_name_hint: 'Atd' } : {}),
          ext_agent_host_id: hostId,
          redirect_uri: callback.redirectUri,
          resource: CHATGPT_RESOURCE,
          scope: SCOPE,
          state,
          nonce,
          code_challenge: await oidc.calculatePKCECodeChallenge(verifier),
          code_challenge_method: 'S256',
          ...(options?.enablePlanUsage ? { prompt: 'consent' } : {}),
        });
        // Do not send an ID-token hint through the renderer. Account selection stays in the browser.
        interaction.notify({
          type: 'auth_url',
          url: url.href,
          instructions: 'Continue with ChatGPT in your browser.',
        });
        const returned = await callback.wait(interaction);
        const error = returned.searchParams.get('error');
        if (error)
          throw new LoginFailure(
            error === 'access_denied'
              ? 'ChatGPT authorization was declined.'
              : 'ChatGPT authorization failed. Try again.',
          );
        const clientId = returned.searchParams.get('client_id') ?? registration?.clientId;
        if (
          !clientId ||
          clientId === 'dynamic_agent_client' ||
          (registration && clientId !== registration.clientId)
        )
          throw new LoginFailure('ChatGPT returned an invalid client registration. Sign in again.');
        if (!returned.searchParams.get('code'))
          throw new LoginFailure('ChatGPT did not return an authorization code.');
        const selected = { ...registration, clientId };
        await registrations.write(selected);
        const issued = new oidc.Configuration(
          config.serverMetadata(),
          clientId,
          undefined,
          oidc.None(),
        );
        const fetcher = config[oidc.customFetch];
        if (fetcher) issued[oidc.customFetch] = fetcher;
        issued.timeout = 15;
        oidc.enableNonRepudiationChecks(issued);
        const tokens = await oauthOperation('exchange', () =>
          oidc.authorizationCodeGrant(
            issued,
            returned,
            {
              expectedState: state,
              expectedNonce: nonce,
              pkceCodeVerifier: verifier,
              idTokenExpected: true,
            },
            { resource: CHATGPT_RESOURCE },
          ),
        );
        const credential = credentialFrom(tokens, selected);
        signal.throwIfAborted();
        await registrations.write({
          clientId,
          subject: credential.subject,
          ...(credential.email ? { email: credential.email } : {}),
        });
        return credential;
      } finally {
        // The login owner answers the browser only after the keyring and connection commit.
        if (!options?.onCallback) await callback.finish({ status: 'error' });
      }
    },
    async refresh(stored, signal) {
      const credential = parse(ChatGPTCredentialSchema, stored);
      const config = await configuration(credential.clientId, signal);
      const tokens = await oidc
        .refreshTokenGrant(config, credential.refresh, { resource: CHATGPT_RESOURCE })
        .catch((error: unknown) => {
          throw terminalChatGPTRefreshError(error) ?? error;
        });
      return credentialFrom(tokens, credential, credential);
    },
    async toAuth(stored) {
      const credential = parse(ChatGPTCredentialSchema, stored);
      if (!credential.scopes.includes(DIRECT_SCOPE))
        throw new LoginFailure(
          'chatgpt_plan_disabled: ChatGPT sign-in succeeded, but plan usage is not enabled.',
        );
      return { apiKey: credential.access, baseUrl: CHATGPT_RESOURCE };
    },
  };
}

/** Called under the credential lock, before local tokens are erased. */
export async function revokeChatGPT(stored: unknown): Promise<boolean> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const credential = parse(ChatGPTCredentialSchema, stored);
      const config = await configuration(credential.clientId, AbortSignal.timeout(5000));
      await oidc.tokenRevocation(config, credential.refresh, { token_type_hint: 'refresh_token' });
      return true;
    } catch {
      if (!attempt) await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  return false;
}
