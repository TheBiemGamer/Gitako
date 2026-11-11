import primitives from '@primer/primitives'
import { BaseStyles, ThemeProvider } from '@primer/react'
import theme from '@primer/react/lib-esm/theme'
import { PropsWithChildren } from 'common'
import { platformName } from 'platforms'
import React, { useEffect, useState } from 'react'

// Temporary color fix for out-of-date embedded @primer/primitives in @primer/react
// The `*_tritanopia` themes are actually not bundled within @primer/react@35.2.2
// TODO: Upgrade @primer/react to support these themes
const fixedTheme = {
  ...theme,
  colorSchemes: {
    ...theme.colorSchemes,
    light_tritanopia: theme.colorSchemes.light,
    dark_tritanopia: theme.colorSchemes.dark,
  },
}

const validColorSchemes = Object.keys(fixedTheme.colorSchemes) as EnumString<
  keyof (typeof primitives)['colors']
>[]

const colorModeMap: Record<string, 'night' | 'day'> = {
  dark: 'night',
  light: 'day',
}

// Gitea / Forgejo: Primer's JS theme carries hex values, so components styled
// through `sx` would ignore the host theme. Rewrite every color into the
// matching Primer CSS variable (e.g. `canvas.default` -> `--color-canvas-default`)
// with the original value as fallback. `styles/forgejo.scss` maps those
// variables onto Forgejo's palette.
const kebab = (key: string) => key.replace(/[A-Z]/g, c => '-' + c.toLowerCase())

function toCSSVariables(colors: unknown, path: string[] = []): unknown {
  if (typeof colors === 'string') return `var(--color-${path.map(kebab).join('-')}, ${colors})`
  if (Array.isArray(colors)) return colors
  if (colors && typeof colors === 'object') {
    return Object.fromEntries(
      Object.entries(colors).map(([key, value]) => [key, toCSSVariables(value, [...path, key])]),
    )
  }
  return colors
}

const isGitea = platformName === 'Gitea'

const hostTheme = isGitea
  ? {
      ...fixedTheme,
      colorSchemes: Object.fromEntries(
        Object.entries(fixedTheme.colorSchemes).map(([name, scheme]) => [
          name,
          { ...scheme, colors: toCSSVariables(scheme.colors) },
        ]),
      ),
    }
  : fixedTheme

function parseRGB(color: string): [number, number, number] | null {
  const match = color.match(/rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)(?:[\s,/]+([\d.]+))?/)
  if (!match) return null
  if (match[4] !== undefined && Number(match[4]) === 0) return null // transparent
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

/**
 * Detect whether the host page currently renders a dark theme by measuring
 * its background luminance. Works for every Forgejo/Gitea theme, including
 * `*-auto` themes and custom ones, without knowing their names.
 */
export function isHostPageDark(): boolean | null {
  const root = document.documentElement
  const isDarkVar = getComputedStyle(root).getPropertyValue('--is-dark-theme').trim()
  if (isDarkVar === 'true') return true
  if (isDarkVar === 'false') return false

  for (const element of [document.body, root]) {
    if (!element) continue
    const rgb = parseRGB(getComputedStyle(element).backgroundColor)
    if (rgb) {
      const [r, g, b] = rgb.map(v => v / 255)
      return 0.2126 * r + 0.7152 * g + 0.0722 * b < 0.5
    }
  }
  return null
}

const getPreferenceFromDOM = () => {
  // <html lang="en" data-color-mode="auto" data-light-theme="light" data-dark-theme="dark" ...
  // <html lang="en" data-color-mode="light" data-light-theme="light" data-dark-theme="dark" ...
  // <html lang="en" data-color-mode="dark" data-light-theme="light" data-dark-theme="dark" ...
  const { colorMode, lightTheme, darkTheme } = document.documentElement.dataset

  if (!colorMode && isGitea) {
    // Forgejo/Gitea: <html data-theme="forgejo-auto"> and friends
    const dark = isHostPageDark()
    return {
      colorMode: dark === null ? 'auto' : dark ? 'night' : 'day',
      dayScheme: 'light',
      nightScheme: 'dark',
    } as const
  }

  return {
    colorMode: (colorMode && colorModeMap[colorMode]) || 'auto',
    dayScheme: lightTheme && validColorSchemes.includes(lightTheme) ? lightTheme : 'light',
    nightScheme: darkTheme && validColorSchemes.includes(darkTheme) ? darkTheme : 'dark',
  } as const
}

function useThemePreference() {
  const [prefer, setPrefer] = useState(getPreferenceFromDOM)
  useEffect(() => {
    const match = window.matchMedia('(prefers-color-scheme: dark)')
    // Let the host stylesheet react to the media change before measuring.
    const update = () => requestAnimationFrame(() => setPrefer(getPreferenceFromDOM))
    match.addEventListener('change', update)
    // Forgejo/Gitea swap the theme by changing `data-theme` or the theme <link>.
    const observer = new MutationObserver(update)
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme', 'data-color-mode', 'class'],
    })
    observer.observe(document.head, { childList: true })
    return () => {
      match.removeEventListener('change', update)
      observer.disconnect()
    }
  }, [])
  return prefer
}

export function Theme({ children }: PropsWithChildren) {
  const themePreference = useThemePreference()
  useEffect(() => {
    if (!isGitea) return
    const mode = themePreference.colorMode === 'night' ? 'dark' : 'light'
    document.documentElement.setAttribute('data-gitako-color-mode', mode)
  }, [themePreference.colorMode])
  return (
    <ThemeProvider {...themePreference} theme={hostTheme}>
      <BaseStyles>{children}</BaseStyles>
    </ThemeProvider>
  )
}
