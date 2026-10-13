import type { Page } from '@playwright/test';

/**
 * WORDS AND MEANING probes (UI audit 2026-10-12, batch C).
 *
 * Two measurements, both taken from the rendered page in a real browser:
 *
 *  1. `probeAsiCodes` walks every visible text node for an OWASP Agentic code
 *     (`ASI01` to `ASI10`, also written `ASI 01` or `ASI-01`) and says how a
 *     reader learns its name without hovering.
 *  2. `probeBreachColour` finds every visible element painted in the breach red
 *     and says what tells a reader what it is besides the colour.
 *
 * The names below are typed out here on purpose and are NOT imported from the
 * app: a test that read the app's own lookup could not catch the lookup being
 * wrong. They are the official titles of the OWASP Top 10 for Agentic
 * Applications (2026).
 */
export const OFFICIAL_ASI_NAMES: Record<string, string> = {
  ASI01: 'Agent Goal Hijack',
  ASI02: 'Tool Misuse and Exploitation',
  ASI03: 'Identity and Privilege Abuse',
  ASI04: 'Agentic Supply Chain Vulnerabilities',
  ASI05: 'Unexpected Code Execution (RCE)',
  ASI06: 'Memory & Context Poisoning',
  ASI07: 'Insecure Inter-Agent Communication',
  ASI08: 'Cascading Agent Failures',
  ASI09: 'Human-Agent Trust Exploitation',
  ASI10: 'Rogue Agents',
};

/** How a rendered code is named. `bare` is the failure. */
export type AsiNaming = 'same-element' | 'row' | 'legend' | 'quoted' | 'bare';

export interface AsiMention {
  code: string;
  /** The text as written on the page, for example `ASI 02`. */
  written: string;
  naming: AsiNaming;
  /** For `quoted`: the reason the container gives for being exempt. */
  reason: string;
  /** A short path to the element, for the failure message. */
  where: string;
  /** The text of the element the code sits in, shortened. */
  text: string;
}

export interface BreachPaint {
  /** Which property is red: `color`, `border`, `background`, `fill`, `stroke`, `shadow`. */
  property: string;
  /** What says so without colour, or `none`. */
  indicator: 'label' | 'mark' | 'none';
  where: string;
  text: string;
}

/**
 * The words that say "this is a breach" (or, for the one other thing red is
 * used for, "this failed") without colour. A red element passes on a label only
 * when one of these is in visible text on it, beside it, or in its row.
 *
 *  - breach, compromise, compromised: the state itself.
 *  - offending: the step the verdict is anchored to.
 *  - sev, severity: a severity value drawn in red sits beside its own caption.
 *  - rationale: the detector's reason for the compromise, a section that is
 *    only drawn on a compromised report, under the COMPROMISED chip.
 *  - failed, error: a copy that failed and a form error.
 */
export const BREACH_WORDS =
  /\b(breach|compromised?|offending|sev|severity|rationale|failed|error)\b/i;

/**
 * Every visible ASI code on the page and how it is named.
 *
 * A code passes when:
 *  - `same-element`: the element whose text it is part of also spells the name;
 *  - `row`: the row it sits in spells the name in visible text. A row is the
 *    nearest list item, table cell, heading, paragraph, term, label, link,
 *    button or `[data-asi]` pair around it;
 *  - `legend`: it sits inside an element whose `aria-describedby` points at an
 *    element that is VISIBLE on the same page and spells the name;
 *  - `quoted`: it sits inside a `[data-asi-quoted]` container, which holds prose
 *    quoted from a trace, a recorded verdict or a generated report. That prose is
 *    evidence and is never rewritten; the attribute's value is the reason.
 */
export function probeAsiCodes(page: Page): Promise<AsiMention[]> {
  return page.evaluate((names) => {
    const squash = (value: string | null | undefined) =>
      (value ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
    const shown = (el: Element | null): boolean => {
      if (!el) return false;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return false;
      const style = getComputedStyle(el);
      if (style.visibility !== 'visible' || style.display === 'none') return false;
      for (let node: Element | null = el; node; node = node.parentElement) {
        const s = getComputedStyle(node);
        if (s.display === 'none' || Number(s.opacity) === 0) return false;
        if (node instanceof HTMLDetailsElement && !node.open && el !== node) {
          const summary: Element | null = node.querySelector(':scope > summary');
          if (!summary || !summary.contains(el)) return false;
        }
      }
      return true;
    };
    const path = (el: Element): string => {
      const parts: string[] = [];
      for (let node: Element | null = el; node && parts.length < 4; node = node.parentElement) {
        const id = node.id ? `#${node.id}` : '';
        const testid = node.getAttribute('data-testid');
        const mark = testid ? `[data-testid="${testid}"]` : '';
        const cls =
          !id && !mark && typeof node.className === 'string' && node.className
            ? `.${node.className.split(/\s+/).slice(0, 2).join('.')}`
            : '';
        parts.unshift(`${node.tagName.toLowerCase()}${id}${mark}${cls}`);
      }
      return parts.join(' > ');
    };

    const ROW =
      '[data-asi], li, tr, th, td, h1, h2, h3, h4, h5, h6, p, dt, dd, label, summary, a, button';
    const found: {
      code: string;
      written: string;
      naming: 'same-element' | 'row' | 'legend' | 'quoted' | 'bare';
      reason: string;
      where: string;
      text: string;
    }[] = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const raw = node.nodeValue ?? '';
      if (!/ASI/.test(raw)) continue;
      const el = node.parentElement;
      if (!el || el.closest('script, style, noscript, template')) continue;
      if (!shown(el)) continue;
      const pattern = /ASI[\s -]?(0[1-9]|10)(?!\d)/g;
      for (let match = pattern.exec(raw); match; match = pattern.exec(raw)) {
        const code = `ASI${match[1]}`;
        const name = squash(names[code]);
        const quoted = el.closest('[data-asi-quoted]');
        const row = el.closest(ROW);
        const described = el.closest('[aria-describedby]');
        let naming: 'same-element' | 'row' | 'legend' | 'quoted' | 'bare' = 'bare';
        let reason = '';
        if (squash(el.textContent).includes(name)) {
          naming = 'same-element';
        } else if (row && shown(row) && squash((row as HTMLElement).innerText).includes(name)) {
          naming = 'row';
        } else if (
          described &&
          (described.getAttribute('aria-describedby') ?? '')
            .split(/\s+/)
            .map((id) => document.getElementById(id))
            .some((entry) => {
              if (!entry || !shown(entry)) return false;
              return squash(entry.innerText).includes(name);
            })
        ) {
          naming = 'legend';
        } else if (quoted) {
          naming = 'quoted';
          reason = quoted.getAttribute('data-asi-quoted') ?? '';
        }
        found.push({
          code,
          written: match[0],
          naming,
          reason,
          where: path(el),
          text: (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 90),
        });
      }
    }
    return found;
  }, OFFICIAL_ASI_NAMES);
}

/**
 * Every visible element painted in the breach red, and what says so without colour.
 *
 * Red is recognised by hue, from the page's own `--red-*` tokens, so a red that
 * was mixed toward transparent still counts. An element passes when:
 *  - `label`: visible text on it, beside it, or in its row is one of BREACH_WORDS;
 *  - `mark`: its row draws an `svg` or `role="img"` mark, and the mark, the row's
 *    control or text kept for screen readers names it with one of BREACH_WORDS;
 *    or it is part of a `role="img"` picture whose name says so.
 *
 * Red text that only happens to be red (a command line, a number) does not
 * pass on its own words: it needs the label or the mark.
 */
export function probeBreachColour(page: Page): Promise<BreachPaint[]> {
  return page.evaluate((wordsSource) => {
    const WORDS = new RegExp(wordsSource, 'i');
    const ROW =
      '[data-breach], li, tr, td, th, button, a, p, dt, dd, summary, h1, h2, h3, h4, h5, h6';
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    const cache = new Map<string, [number, number, number, number]>();
    /** Any CSS colour to r, g, b (0 to 255) and alpha (0 to 1). */
    const rgba = (value: string): [number, number, number, number] => {
      const hit = cache.get(value);
      if (hit) return hit;
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = '#000';
      ctx.fillStyle = value;
      ctx.fillRect(0, 0, 1, 1);
      const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
      // Canvas stores premultiplied alpha: undo it for the hue.
      const alpha = (a ?? 0) / 255;
      const out: [number, number, number, number] =
        alpha === 0 ? [0, 0, 0, 0] : [r ?? 0, g ?? 0, b ?? 0, alpha];
      cache.set(value, out);
      return out;
    };
    const hueSat = (r: number, g: number, b: number): [number, number] => {
      const max = Math.max(r, g, b) / 255;
      const min = Math.min(r, g, b) / 255;
      const d = max - min;
      if (d === 0) return [0, 0];
      const l = (max + min) / 2;
      const s = d / (1 - Math.abs(2 * l - 1));
      let h = 0;
      if (max === r / 255) h = ((g - b) / 255 / d) % 6;
      else if (max === g / 255) h = (b - r) / 255 / d + 2;
      else h = (r - g) / 255 / d + 4;
      return [(h * 60 + 360) % 360, s];
    };
    const root = getComputedStyle(document.documentElement);
    const redHues = ['--red-200', '--red-400', '--red-600', '--red-800']
      .map((token) => root.getPropertyValue(token).trim())
      .filter(Boolean)
      .map((value) => hueSat(...(rgba(value).slice(0, 3) as [number, number, number]))[0]);
    const isRed = (value: string): boolean => {
      if (!value || value === 'none' || value === 'transparent') return false;
      const [r, g, b, a] = rgba(value);
      if (a < 0.2) return false;
      const [h, s] = hueSat(r, g, b);
      if (s < 0.3) return false;
      return redHues.some((red) => {
        const gap = Math.abs(h - red);
        return Math.min(gap, 360 - gap) <= 12;
      });
    };
    const coloursIn = (value: string): string[] =>
      value.match(
        /(rgba?|color|oklch|oklab|hsla?|lab|lch)\([^()]*(\([^()]*\)[^()]*)*\)|#[0-9a-f]{3,8}/gi,
      ) ?? [];

    const shown = (el: Element): boolean => {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return false;
      for (let node: Element | null = el; node; node = node.parentElement) {
        const s = getComputedStyle(node);
        if (s.display === 'none' || s.visibility !== 'visible' || Number(s.opacity) === 0) {
          return false;
        }
      }
      return true;
    };
    const word = (value: string | null | undefined) => /[A-Za-z]{3,}/.test(value ?? '');
    const says = (value: string | null | undefined) => WORDS.test(value ?? '');
    const ownText = (el: Element) =>
      Array.from(el.childNodes)
        .filter((n) => n.nodeType === Node.TEXT_NODE)
        .map((n) => n.nodeValue ?? '')
        .join(' ');
    const rendered = (el: Element | null) =>
      el instanceof HTMLElement && shown(el) ? el.innerText : '';
    /** A mark drawn in `el`, named with a breach word by itself, its control or hidden text. */
    const marked = (el: Element | null): boolean => {
      if (!el) return false;
      const marks = Array.from(el.querySelectorAll('svg, [role="img"]')).filter(shown);
      if (el.tagName.toLowerCase() === 'svg') marks.push(el);
      if (marks.length === 0) return false;
      const control = el.closest('button, a, [role="img"]') ?? el;
      return (
        says(control.getAttribute('aria-label')) ||
        says(el.getAttribute('aria-label')) ||
        marks.some(
          (mark) =>
            says(mark.getAttribute('aria-label')) || says(mark.querySelector('title')?.textContent),
        ) ||
        Array.from(el.querySelectorAll('.sr-only')).some((hidden) => says(hidden.textContent))
      );
    };
    const path = (el: Element): string => {
      const parts: string[] = [];
      for (let node: Element | null = el; node && parts.length < 4; node = node.parentElement) {
        const id = node.id ? `#${node.id}` : '';
        const testid = node.getAttribute('data-testid');
        const mark = testid ? `[data-testid="${testid}"]` : '';
        const className = node.getAttribute('class') ?? '';
        const cls =
          !id && !mark && className ? `.${className.split(/\s+/).slice(0, 2).join('.')}` : '';
        parts.unshift(`${node.tagName.toLowerCase()}${id}${mark}${cls}`);
      }
      return parts.join(' > ');
    };

    const out: {
      property: string;
      indicator: 'label' | 'mark' | 'none';
      where: string;
      text: string;
    }[] = [];
    for (const el of Array.from(document.body.querySelectorAll('*'))) {
      if (el.closest('script, style, noscript, template')) continue;
      if (!shown(el)) continue;
      const style = getComputedStyle(el);
      const svg = el instanceof SVGElement;
      const painted: string[] = [];
      if (!svg && word(ownText(el)) && isRed(style.color)) painted.push('color');
      if (!svg && /[^\s]/.test(ownText(el)) && !word(ownText(el)) && isRed(style.color)) {
        painted.push('color');
      }
      if (
        !svg &&
        (['Top', 'Right', 'Bottom', 'Left'] as const).some(
          (side) =>
            parseFloat(style[`border${side}Width`]) > 0 &&
            style[`border${side}Style`] !== 'none' &&
            isRed(style[`border${side}Color`]),
        )
      ) {
        painted.push('border');
      }
      if (!svg && isRed(style.backgroundColor)) painted.push('background');
      if (!svg && coloursIn(style.boxShadow).some(isRed)) painted.push('shadow');
      if (svg && el.tagName.toLowerCase() !== 'svg') {
        if (isRed(style.fill)) painted.push('fill');
        if (parseFloat(style.strokeWidth) > 0 && isRed(style.stroke)) painted.push('stroke');
      }
      if (painted.length === 0) continue;

      const unit: Element = svg ? (el.closest('svg') ?? el) : el;
      const parent = unit.parentElement;
      const row = unit.closest(ROW);
      let indicator: 'label' | 'mark' | 'none' = 'none';
      if (
        says(rendered(unit)) ||
        says(rendered(unit.previousElementSibling)) ||
        says(rendered(unit.nextElementSibling)) ||
        (parent && shown(parent) && says(ownText(parent))) ||
        says(rendered(row))
      ) {
        indicator = 'label';
      } else if (
        marked(row) ||
        marked(unit) ||
        marked(parent) ||
        says(unit.closest('[role="img"]')?.getAttribute('aria-label'))
      ) {
        indicator = 'mark';
      }
      out.push({
        property: painted.join('+'),
        indicator,
        where: path(el),
        text: (rendered(unit) || unit.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60),
      });
    }
    return out;
  }, BREACH_WORDS.source);
}
