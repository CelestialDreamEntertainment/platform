import { DEFAULT_THEME, mergeMantineTheme } from '@mantine/core';
import { describe, expect, it } from 'vitest';
import { baseTheme, createAppTheme, cssVariablesResolver, DARK } from './theme.js';

const luminance = (hex: string): number => {
    const [r, g, b] = [1, 3, 5].map((i) => {
        const c = parseInt(hex.slice(i, i + 2), 16) / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    }) as [number, number, number];
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: string, b: string): number => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
    return (hi + 0.05) / (lo + 0.05);
};

describe('theme', () => {
    const theme = mergeMantineTheme(DEFAULT_THEME, baseTheme);
    const vars = cssVariablesResolver(theme);

    it('uses a near-black dark background', () => {
        expect(DARK[7]).toBe('#121212');
        expect(theme.colors.dark[7]).toBe('#121212');
    });

    it('meets WCAG AA for text and dimmed text in dark mode', () => {
        expect(contrast(DARK[0], DARK[7])).toBeGreaterThanOrEqual(4.5);
        expect(
            contrast(vars.dark['--mantine-color-dimmed'] as string, DARK[7])
        ).toBeGreaterThanOrEqual(4.5);
        expect(contrast(DARK[0], DARK[6])).toBeGreaterThanOrEqual(4.5);
    });

    it('meets WCAG AA for dimmed text in light mode', () => {
        expect(
            contrast(vars.light['--mantine-color-dimmed'] as string, '#ffffff')
        ).toBeGreaterThanOrEqual(4.5);
    });

    it('falls back if the gray palette is missing', () => {
        const bare = cssVariablesResolver({
            ...theme,
            colors: { ...theme.colors, gray: [] as never }
        });
        expect(bare.light['--mantine-color-dimmed']).toBe('#495057');
    });

    it('turns on autoContrast and a darker primary shade in dark mode', () => {
        expect(theme.autoContrast).toBe(true);
        expect(theme.primaryShade).toEqual({ light: 6, dark: 8 });
    });

    it("extends the base theme with the app's primary color", () => {
        const app = mergeMantineTheme(
            DEFAULT_THEME,
            createAppTheme('grape', { defaultRadius: 'md' })
        );
        expect(app.primaryColor).toBe('grape');
        expect(app.defaultRadius).toBe('md');
        expect(app.colors.dark[7]).toBe('#121212');
        expect(createAppTheme('teal').primaryColor).toBe('teal');
    });
});
