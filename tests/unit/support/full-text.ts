/**
 * Find an element by its WHOLE text, however it is split into spans. A
 * provenance line wraps only between its segments, so each segment is a span
 * of its own (PROVENANCE WRAP, 2026-10-21), and `getByText` on the joined line
 * no longer meets one text node. This matches the innermost element whose text
 * is exactly the line.
 */
export const fullText =
  (text: string) =>
  (_content: string, el: Element | null): boolean =>
    el !== null &&
    el.textContent === text &&
    ![...el.children].some((child) => child.textContent === text);
