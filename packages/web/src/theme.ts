import {
    createTheme,
    mergeThemeOverrides,
    type CSSVariablesResolver,
    type MantineThemeOverride
} from '@mantine/core';

/**
 * Mantine's dark palette, retuned for contrast: a near-black background (`dark[7]`, like Material
 * UI's #121212), brighter text (`dark[0]`) and brighter dimmed text (`dark[2]`).
 */
export const DARK = [
    '#ececec',
    '#d4d4d4',
    '#b0b0b0',
    '#8a8a8a',
    '#4d4d4d',
    '#333333',
    '#1f1f1f',
    '#121212',
    '#0c0c0c',
    '#060606'
] as const;

/** The base theme every app extends: contrast tuning only, no look of its own. */
export const baseTheme: MantineThemeOverride = createTheme({
    autoContrast: true,
    primaryShade: { light: 6, dark: 8 },
    colors: { dark: [...DARK] }
});

/** Mantine's default dimmed text is too faint on white to meet WCAG AA, so it's one shade darker. */
export const cssVariablesResolver: CSSVariablesResolver = (theme) => ({
    variables: {},
    light: { '--mantine-color-dimmed': theme.colors.gray[7] ?? '#495057' },
    dark: { '--mantine-color-dimmed': DARK[2] }
});

/** The app's theme: the base theme with the app's own primary color and any overrides. */
export const createAppTheme = (
    primaryColor: string,
    overrides: MantineThemeOverride = {}
): MantineThemeOverride => mergeThemeOverrides(baseTheme, { primaryColor }, overrides);
