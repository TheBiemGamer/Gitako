import { raiseError } from 'analytics'
import { $ } from 'utils/$'

// Selectors cover both Forgejo (v7+) and Gitea. Forgejo dropped the legacy
// `.reference` branch button in favour of `.branch-dropdown-button`.
const branchButtonSelectors = [
  '.branch-dropdown-button', // Forgejo
  '.repo-button-row .js-branch-tag-selector button', // Forgejo/Gitea fallback
  '.reference', // legacy Gitea
]

const codePageSelectors = [
  ...branchButtonSelectors,
  '#repo-files-table', // directory listing
  '.page-content.repository.file', // file view & repo home
  '.repository .file-view', // file view
]

export function isInRepoPage() {
  const repoHeaderSelector = '.repo-header'
  return Boolean($(repoHeaderSelector))
}

export function isInCodePage() {
  return codePageSelectors.some(selector => Boolean($(selector)))
}

export function isForgejo() {
  const theme = document.documentElement.dataset.theme || ''
  return (
    theme.startsWith('forgejo') ||
    Boolean(document.querySelector('meta[name="keywords"][content*="forgejo" i]')) ||
    Boolean(document.querySelector('a[href*="forgejo.org"]'))
  )
}

export function getCurrentBranch() {
  for (const selector of branchButtonSelectors) {
    const button = $(selector)
    if (!button) continue
    const nameElement =
      button.querySelector('strong[ref="dropdownRefName"]') ||
      button.querySelector('.text > strong') ||
      button.querySelector('strong')
    const name = nameElement?.textContent?.trim()
    if (name) return name
  }

  raiseError(new Error('cannot get current branch'))
}
