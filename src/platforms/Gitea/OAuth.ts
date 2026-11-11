/**
 * OAuth2 for self-hosted Forgejo / Gitea instances.
 *
 * Every instance is its own OAuth provider, so there is no shared Gitako app.
 * The user registers a *public* (non-confidential) OAuth2 application on their
 * instance once and pastes its Client ID into Gitako. Public clients use PKCE
 * instead of a client secret, so no backend is involved: the token exchange is
 * a same-origin request from the content script to the instance itself.
 *
 * Redirect URI: `${origin}/` (the instance home page). The callback is handled
 * on whichever page Forgejo lands on, before Gitako mounts, then the user is
 * sent back to the page where they started.
 */
import { configHelper, configRef } from 'utils/config/helper'

const STATE_KEY = 'gitako:oauth:state'
const VERIFIER_KEY = 'gitako:oauth:verifier'
const RETURN_KEY = 'gitako:oauth:return'

// refresh a minute early to avoid using a token that expires mid-request
const EXPIRY_MARGIN = 60 * 1000

export const getRedirectURI = () => `${window.location.origin}/`
export const getApplicationsSettingsURL = () =>
  `${window.location.origin}/user/settings/applications`

function base64URL(bytes: Uint8Array) {
  let binary = ''
  bytes.forEach(byte => (binary += String.fromCharCode(byte)))
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function randomString(byteLength = 32) {
  return base64URL(crypto.getRandomValues(new Uint8Array(byteLength)))
}

async function createChallenge(verifier: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return base64URL(new Uint8Array(digest))
}

type TokenResponse = {
  access_token?: string
  refresh_token?: string
  expires_in?: number
  error?: string
  error_description?: string
}

async function requestToken(params: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(`${window.location.origin}/login/oauth/access_token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: new URLSearchParams(params),
    credentials: 'omit',
  })
  const data: TokenResponse = await res.json().catch(() => ({}))
  if (!res.ok || !data.access_token) {
    throw new Error(data.error_description || data.error || `Token request failed (${res.status})`)
  }
  return data
}

async function saveTokens(data: TokenResponse) {
  await configHelper.update({
    accessToken: data.access_token,
    oauthRefreshToken: data.refresh_token || '',
    oauthTokenExpiresAt: data.expires_in ? Date.now() + data.expires_in * 1000 : 0,
  })
}

export async function startOAuthFlow(clientId: string) {
  const state = randomString(16)
  const verifier = randomString(48)
  sessionStorage.setItem(STATE_KEY, state)
  sessionStorage.setItem(VERIFIER_KEY, verifier)
  sessionStorage.setItem(RETURN_KEY, window.location.href)

  const search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: getRedirectURI(),
    response_type: 'code',
    state,
    code_challenge: await createChallenge(verifier),
    code_challenge_method: 'S256',
  })
  window.location.href = `${window.location.origin}/login/oauth/authorize?${search}`
}

/**
 * Finish the flow if the current page is the OAuth callback we started.
 * Returns true when the page is navigating away (to the original page).
 */
export async function handleOAuthCallback(): Promise<boolean> {
  const search = new URLSearchParams(window.location.search)
  const code = search.get('code')
  const state = search.get('state')
  const expectedState = sessionStorage.getItem(STATE_KEY)
  if (!state || !expectedState) return false
  if (state !== expectedState) return false

  const verifier = sessionStorage.getItem(VERIFIER_KEY) || ''
  const returnTo = sessionStorage.getItem(RETURN_KEY) || getRedirectURI()
  sessionStorage.removeItem(STATE_KEY)
  sessionStorage.removeItem(VERIFIER_KEY)
  sessionStorage.removeItem(RETURN_KEY)

  // Don't leave the one-time code in the address bar / history.
  const cleaned = new URL(window.location.href)
  ;['code', 'state', 'error', 'error_description'].forEach(key => cleaned.searchParams.delete(key))
  window.history.replaceState(window.history.state, '', cleaned.toString())

  const error = search.get('error')
  if (error || !code) {
    alert(`Gitako: Forgejo sign-in was cancelled or failed (${error || 'no code'}).`)
    return false
  }

  try {
    const config = await configHelper.get()
    const data = await requestToken({
      client_id: config.oauthClientId || '',
      grant_type: 'authorization_code',
      code,
      redirect_uri: getRedirectURI(),
      code_verifier: verifier,
    })
    await saveTokens(data)
    window.location.replace(returnTo)
    return true
  } catch (err) {
    alert(`Gitako: Forgejo sign-in failed. ${err instanceof Error ? err.message : ''}`)
    return false
  }
}

let refreshing: Promise<string | undefined> | null = null

/**
 * Returns a usable access token: the stored one, or a refreshed one when an
 * OAuth token has (almost) expired. Tokens set manually never expire here.
 */
export async function getFreshAccessToken(accessToken?: string): Promise<string | undefined> {
  const { oauthRefreshToken, oauthTokenExpiresAt, oauthClientId } = configRef
  const current = configRef.accessToken || accessToken
  if (!oauthRefreshToken || !oauthClientId || !oauthTokenExpiresAt) return current
  if (Date.now() < oauthTokenExpiresAt - EXPIRY_MARGIN) return current

  if (!refreshing) {
    refreshing = requestToken({
      client_id: oauthClientId,
      grant_type: 'refresh_token',
      refresh_token: oauthRefreshToken,
    })
      .then(async data => {
        await saveTokens(data)
        return data.access_token
      })
      .catch(async () => {
        // refresh token revoked or expired: fall back to anonymous / session access
        await configHelper.update({
          accessToken: '',
          oauthRefreshToken: '',
          oauthTokenExpiresAt: 0,
        })
        return undefined
      })
      .finally(() => (refreshing = null))
  }
  return refreshing
}
