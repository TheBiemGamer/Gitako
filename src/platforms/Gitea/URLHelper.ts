import { raiseError } from 'analytics'
import { sanitizedLocation } from 'utils/URLHelper'

export function parse(): Partial<MetaData> & { path: string[] } {
  const [
    ,
    // ignore content before the first '/'
    userName,
    repoName,
    type,
    ...path // should be [...branchName.split('/'), ...filePath.split('/')]
  ] = unescape(decodeURIComponent(sanitizedLocation.pathname)).split('/')
  return {
    userName,
    repoName,
    branchName: undefined,
    type,
    path,
  }
}

// Gitea/Forgejo code URLs look like
//   /{user}/{repo}/src/branch/{branch}/{path}
//   /{user}/{repo}/src/tag/{tag}/{path}
//   /{user}/{repo}/src/commit/{sha}/{path}
// and the legacy GitHub-like /{user}/{repo}/(blob|tree)/{ref}/{path}.
const refKinds = ['branch', 'tag', 'commit']

function getRefAndPath(): { kind?: string; path: string[] } | null {
  const { type, path } = parse()
  if (type === 'src') {
    const [kind, ...rest] = path
    if (refKinds.includes(kind)) return { kind, path: rest }
    return { path }
  }
  if (type === 'blob' || type === 'tree') return { path }
  return null
}

export function parseSHA() {
  const parsed = getRefAndPath()
  if (!parsed) return undefined
  if (parsed.kind === 'commit' || !parsed.kind) return parsed.path[0]
  return undefined
}

function isCommitPath(path: string[]) {
  return isCompleteCommitSHA(path[0])
}

function isCompleteCommitSHA(sha?: string) {
  return typeof sha === 'string' && /^[abcdef0-9]{40}$/i.test(sha)
}

export function getCurrentPath(branchName = '') {
  const parsed = getRefAndPath()
  if (!parsed) return []
  const { kind, path } = parsed
  if (kind === 'commit' || isCommitPath(path)) {
    // path = commit-SHA/path/to/item
    path.shift()
  } else if (path[0] === 'HEAD') {
    // HEAD is not a valid branch name. Getting HEAD means being detached.
    path.shift()
  } else {
    const splitBranchName = branchName.split('/')
    while (splitBranchName.length) {
      if (
        splitBranchName[0] === path[0] ||
        // Keep consuming as their heads are same
        (splitBranchName.length === 1 && path[0] && splitBranchName[0].startsWith(path[0]))
        // This happens when visiting URLs with a commit SHA shorter than we got from DOM
      ) {
        splitBranchName.shift()
        path.shift()
      } else {
        raiseError(new Error(`branch name and path prefix not match`), {
          branchName,
          path: parse().path,
        })
        return []
      }
    }
  }
  return path.map(decodeURIComponent)
}
