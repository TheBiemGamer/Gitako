import {
  defaultSites,
  ext,
  getSites,
  hasPermission,
  setSites,
  Site,
  SITES_STORAGE_KEY,
  toMatchPattern,
} from './sites'

// Hosts Gitako talks to that are not sites
const nonSiteHosts = ['gitako.enix.one', 'sentry.io', 'api.github.com']

/** Register content scripts for every enabled site we have host access to. */
async function syncContentScripts() {
  const sites = await getSites()
  // Drop everything this extension registered before, including scripts left
  // by the old webext-dynamic-content-scripts toggle.
  await ext.scripting.unregisterContentScripts()
  const scripts: browser.scripting.RegisteredContentScript[] = []
  for (const { origin, enabled } of sites) {
    if (!enabled || !(await hasPermission(origin))) continue
    const matches = [toMatchPattern(origin)]
    scripts.push(
      {
        id: `gitako-early ${origin}`,
        matches,
        js: ['early.js'],
        css: ['content.css'],
        runAt: 'document_start',
      },
      {
        id: `gitako-main ${origin}`,
        matches,
        js: ['firefox-shim.js', 'browser-polyfill.js', 'content.js'],
        runAt: 'document_idle',
      },
    )
  }
  if (scripts.length) await ext.scripting.registerContentScripts(scripts)
}

// Serialize syncs: registering the same id twice in parallel throws
let syncing: Promise<void> = Promise.resolve()
const sync = () => (syncing = syncing.then(syncContentScripts).catch(console.error))

/**
 * First run (fresh install, or update from the version with the per-domain
 * permission toggle): start from the defaults plus any domain the user had
 * already granted.
 */
async function migrateGrantedOrigins() {
  const stored = (await ext.storage.local.get(SITES_STORAGE_KEY))[SITES_STORAGE_KEY]
  if (Array.isArray(stored)) return
  const sites: Site[] = defaultSites.map(site => ({ ...site }))
  // only optional grants (what the old toggle produced), not the manifest's own
  const required = ext.runtime.getManifest().host_permissions || []
  const { origins = [] } = await ext.permissions.getAll()
  for (const pattern of origins) {
    if (required.includes(pattern)) continue
    const match = /^(https?):\/\/([^/*]+)\/\*$/.exec(pattern)
    if (!match) continue
    const [, protocol, host] = match
    if (nonSiteHosts.some(nonSite => host.endsWith(nonSite))) continue
    const origin = `${protocol}://${host}`
    if (!sites.some(site => site.origin === origin)) sites.push({ origin, enabled: true })
  }
  await setSites(sites)
}

// Toolbar button context menu: switch the current site on or off
const MENU_ID = 'gitako-toggle-site'

async function getTabOrigin(tabId?: number) {
  if (tabId === undefined) return null
  const tab = await ext.tabs.get(tabId).catch(() => null)
  if (!tab?.url) return null
  try {
    const url = new URL(tab.url)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.origin : null
  } catch {
    return null
  }
}

async function updateMenu(tabId?: number) {
  const origin = await getTabOrigin(tabId)
  const site = origin && (await getSites()).find(site => site.origin === origin)
  const checked = Boolean(site && site.enabled && (await hasPermission(site.origin)))
  await ext.contextMenus.update(MENU_ID, { enabled: Boolean(origin), checked }).catch(() => {})
}

async function createMenu() {
  await ext.contextMenus.removeAll()
  ext.contextMenus.create({
    id: MENU_ID,
    type: 'checkbox',
    title: 'Run Gitako on this site',
    contexts: ['action'],
  })
}

ext.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== MENU_ID || !tab?.id || !tab.url) return
  const tabId = tab.id
  const origin = new URL(tab.url).origin
  const enable = Boolean(info.checked)
  // permissions.request must run synchronously in the click handler (user gesture)
  const granted = enable
    ? ext.permissions.request({ origins: [toMatchPattern(origin)] })
    : Promise.resolve(true)
  granted
    .then(async ok => {
      if (ok) {
        const sites = await getSites()
        const existing = sites.find(site => site.origin === origin)
        if (existing) existing.enabled = enable
        else if (enable) sites.push({ origin, enabled: true })
        await setSites(sites)
        await sync()
        await ext.tabs.reload(tabId)
      }
      await updateMenu(tabId)
    })
    .catch(console.error)
})

ext.tabs.onActivated.addListener(({ tabId }) => void updateMenu(tabId))
ext.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url && tab.active) void updateMenu(tabId)
})

ext.runtime.onInstalled.addListener(() => {
  void createMenu()
  migrateGrantedOrigins().then(sync)
})
ext.runtime.onStartup.addListener(() => {
  void createMenu()
  void sync()
})
ext.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && SITES_STORAGE_KEY in changes) void sync()
})
ext.permissions.onAdded.addListener(() => void sync())
ext.permissions.onRemoved.addListener(() => void sync())
