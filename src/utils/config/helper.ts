import { SearchMode } from 'components/searchModes'
import { platformName } from 'platforms'
import { Storage, storageHelper } from 'utils/storageHelper'
import { migrateConfig } from './migrations'

export type Config = {
  sideBarWidth: number
  shortcut: string | undefined // shortcut for toggling sidebar
  focusSearchInputShortcut: string | undefined // shortcut for focusing search input
  accessToken: string | undefined
  compressSingletonFolder: boolean
  copySnippetButton: boolean
  intelligentToggle: boolean | null // `null` stands for intelligent, boolean for sidebar open state
  icons: 'rich' | 'dim' | 'native'
  toggleButtonVerticalDistance: number
  recursiveToggleFolder: 'shift' | 'alt'
  searchMode: SearchMode
  sidebarToggleMode: 'persistent' | 'float'
  commentToggle: boolean
  codeFolding: boolean
  compactFileTree: boolean
  restoreExpandedFolders: boolean
  pjaxMode: 'native' | 'pjax-api'
  showDiffInText: boolean
  sidebarPlacement: 'left' | 'right'
  neverShowSidebarAutoCollapseHint: boolean
  deferToNativeFileTree: boolean
  // Forgejo/Gitea OAuth2 (PKCE) — per instance, see platforms/Gitea/OAuth.ts
  oauthClientId: string
  oauthRefreshToken: string
  oauthTokenExpiresAt: number
  __showInspector?: boolean
}

export type ConfigKeys = keyof Config

enum configKeys {
  sideBarWidth = 'sideBarWidth',
  shortcut = 'shortcut',
  focusSearchInputShortcut = 'focusSearchInputShortcut',
  accessToken = 'accessToken',
  compressSingletonFolder = 'compressSingletonFolder',
  copySnippetButton = 'copySnippetButton',
  intelligentToggle = 'intelligentToggle',
  icons = 'icons',
  toggleButtonVerticalDistance = 'toggleButtonVerticalDistance',
  recursiveToggleFolder = 'recursiveToggleFolder',
  searchMode = 'searchMode',
  sidebarToggleMode = 'sidebarToggleMode',
  commentToggle = 'commentToggle',
  codeFolding = 'codeFolding',
  compactFileTree = 'compactFileTree',
  restoreExpandedFolders = 'restoreExpandedFolders',
  pjaxMode = 'pjaxMode',
  showDiffInText = 'showDiffInText',
  sidebarPlacement = 'sidebarPlacement',
  neverShowSidebarAutoCollapseHint = 'neverShowSidebarAutoCollapseHint',
  deferToNativeFileTree = 'deferToNativeFileTree',
  oauthClientId = 'oauthClientId',
  oauthRefreshToken = 'oauthRefreshToken',
  oauthTokenExpiresAt = 'oauthTokenExpiresAt',
  __showInspector = '__showInspector',
}

// NOT use platform name to distinguish GHE from github.com
const platformStorageKey = `platform_` + window.location.host.toLowerCase()
const isInGitHub = platformStorageKey === 'platform_github.com'

export const getDefaultConfigs: () => Config = () => ({
  sideBarWidth: 260,
  shortcut: undefined,
  focusSearchInputShortcut: undefined,
  accessToken: '',
  compressSingletonFolder: true,
  copySnippetButton: !isInGitHub, // disable on github.com
  intelligentToggle: null,
  icons: 'rich',
  toggleButtonVerticalDistance: 64, // align with GitHub's navbar items
  recursiveToggleFolder: 'shift',
  searchMode: 'fuzzy',
  // Gitea/Forgejo have no native file tree, so keep the sidebar docked and open
  sidebarToggleMode: platformName === 'Gitea' ? 'persistent' : 'float',
  commentToggle: true,
  codeFolding: !isInGitHub, // disable on github.com; native gutter folding covers it, preserved for GHE
  compactFileTree: false,
  restoreExpandedFolders: true,
  // pjax-api only on Gitee; GitHub has its own soft navigation, Gitea/Forgejo
  // need full loads (see platforms/Gitea loadWithFastRedirect)
  pjaxMode: platformName === 'Gitee' ? 'pjax-api' : 'native',
  showDiffInText: false,
  sidebarPlacement: 'left',
  neverShowSidebarAutoCollapseHint: false,
  deferToNativeFileTree: true,
  oauthClientId: '',
  oauthRefreshToken: '',
  oauthTokenExpiresAt: 0,
})

const configKeyArray = Object.values(configKeys)

function applyDefaultConfigs(configs: Partial<Config> = {}) {
  const defaultConfigs = getDefaultConfigs()
  return configKeyArray.reduce((applied, key) => {
    Object.assign(applied, { [key]: key in configs ? configs[key] : defaultConfigs[key] })
    return applied
  }, {} as Config)
}

export type VersionedConfig<SiteConfig> = Record<string, SiteConfig> & Storage

export const configRef: Partial<Config> = {}
const updateConfigRef = async (config: Partial<Config>) => {
  Object.assign(configRef, config)
}

const configMigration = migrateConfig()
configMigration.then(async () => updateConfigRef(await get()))

let loadedConfigFromURL = false

function getConfigFromURL() {
  const config: Partial<Config> = {}
  // config params pattern:
  // ?gitako-config-<key>=<json-value>
  new URLSearchParams(window.location.search).forEach((value, key) => {
    if (key.match(/^gitako-config-/)) {
      const configKey = key.replace(/^gitako-config-/, '')
      if (configKey in configKeys) {
        try {
          config[configKeys[configKey as configKeys]] = JSON.parse(value)
          loadedConfigFromURL = true
        } catch (error) {
          throw new Error(`Failed to parse config "${configKey}" from URL: ${value}`, {
            cause: error,
          })
        }
      } else {
        console.warn(`Unknown config "${configKey}" from URL: ${value}`)
      }
    }
  })

  return config
}

async function get(): Promise<Config> {
  await configMigration
  const savedConfig = (await storageHelper.get<Record<string, Config>>([platformStorageKey]))?.[
    platformStorageKey
  ]
  const configFromURL = getConfigFromURL()
  return applyDefaultConfigs({ ...savedConfig, ...configFromURL })
}

async function set(config: Config) {
  updateConfigRef(config)
  if (!loadedConfigFromURL) await storageHelper.set({ [platformStorageKey]: config })
}

// Fired on window when config is written outside ConfigsContext.
export const configUpdatedEventType = 'gitako:config-updated'

/** Merge and persist a partial config from outside React, and notify the context. */
async function update(partial: Partial<Config>) {
  const config = { ...(await get()), ...partial }
  await set(config)
  window.dispatchEvent(new CustomEvent(configUpdatedEventType, { detail: partial }))
  return config
}

export const configHelper = { get, set, update }
