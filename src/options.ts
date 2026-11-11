import {
  ext,
  getSites,
  hasPermission,
  normalizeOrigin,
  setSites,
  Site,
  toMatchPattern,
} from './sites'

const list = document.getElementById('sites') as HTMLUListElement
const form = document.getElementById('add-form') as HTMLFormElement
const input = document.getElementById('new-site') as HTMLInputElement
const message = document.getElementById('message') as HTMLParagraphElement

function say(text: string, isError = false) {
  message.textContent = text
  message.classList.toggle('error', isError)
}

// permissions.request has to be called directly in the click handler
function requestAccess(origin: string) {
  return ext.permissions.request({ origins: [toMatchPattern(origin)] })
}

async function update(change: (sites: Site[]) => Site[]) {
  await setSites(change(await getSites()))
  await render()
}

// Renders can overlap (storage changes while one is awaiting); only the
// latest one may touch the list, and it swaps in all rows at once.
let renderId = 0
async function render() {
  const id = ++renderId
  const sites = await getSites()
  const items: HTMLLIElement[] = []
  if (!sites.length) {
    const empty = document.createElement('li')
    empty.className = 'empty'
    empty.textContent = 'No sites yet. Gitako runs nowhere.'
    items.push(empty)
  }
  for (const site of sites) {
    const granted = await hasPermission(site.origin)
    const item = document.createElement('li')
    item.classList.toggle('off', !site.enabled)

    const label = document.createElement('div')
    label.className = 'origin'
    const name = document.createElement('span')
    name.textContent = site.origin
    label.append(name)
    if (!granted) {
      const note = document.createElement('small')
      note.textContent = 'No access yet'
      label.append(note)
    }

    const actions: HTMLElement[] = []
    if (!granted) {
      const grant = document.createElement('button')
      grant.textContent = 'Allow access'
      grant.addEventListener('click', () => {
        requestAccess(site.origin).then(ok => {
          if (!ok) say(`Access to ${site.origin} was not granted.`, true)
          return update(sites =>
            sites.map(s => (s.origin === site.origin ? { ...s, enabled: true } : s)),
          )
        })
      })
      actions.push(grant)
    }

    const toggle = document.createElement('label')
    toggle.className = 'switch'
    const checkbox = document.createElement('input')
    checkbox.type = 'checkbox'
    checkbox.checked = site.enabled
    checkbox.setAttribute('aria-label', `Run Gitako on ${site.origin}`)
    checkbox.addEventListener('change', () => {
      const enabled = checkbox.checked
      const access = enabled && !granted ? requestAccess(site.origin) : Promise.resolve(true)
      access.then(ok => {
        if (!ok) say(`Access to ${site.origin} was not granted.`, true)
        else say(`${enabled ? 'Enabled' : 'Disabled'} ${site.origin}. Reload its tabs to apply.`)
        return update(sites =>
          sites.map(s => (s.origin === site.origin ? { ...s, enabled: enabled && ok } : s)),
        )
      })
    })
    const track = document.createElement('span')
    toggle.append(checkbox, track)

    const remove = document.createElement('button')
    remove.className = 'danger'
    remove.textContent = 'Remove'
    remove.setAttribute('aria-label', `Remove ${site.origin}`)
    remove.addEventListener('click', async () => {
      await update(sites => sites.filter(s => s.origin !== site.origin))
      // Required host permissions (the defaults) cannot be removed; that's fine
      await ext.permissions.remove({ origins: [toMatchPattern(site.origin)] }).catch(() => false)
      say(`Removed ${site.origin}.`)
    })

    item.append(label, ...actions, toggle, remove)
    items.push(item)
  }
  if (id === renderId) list.replaceChildren(...items)
}

form.addEventListener('submit', event => {
  event.preventDefault()
  const origin = normalizeOrigin(input.value)
  if (!origin) {
    say('Enter a site address, like https://git.example.com', true)
    return
  }
  requestAccess(origin)
    .then(async ok => {
      if (!ok) {
        say(`Access to ${origin} was not granted, so it was not added.`, true)
        return
      }
      await update(sites =>
        sites.some(s => s.origin === origin)
          ? sites.map(s => (s.origin === origin ? { ...s, enabled: true } : s))
          : [...sites, { origin, enabled: true }],
      )
      input.value = ''
      say(`Added ${origin}. Open or reload one of its pages.`)
    })
    .catch(error => say(String(error?.message || error), true))
})

ext.storage.onChanged.addListener(() => void render())
void render()
