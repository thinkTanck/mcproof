import { CoverageIcon } from './CoverageIcon';

/**
 * The three-state coverage legend. Each state carries an icon AND a text label
 * (never color alone). NOT TESTABLE and COULD BE ADDED LATER resolve through the neutral
 * `--status-inert` token: muted, no glow, never the breach red.
 */
export function CoverageLegend() {
  return (
    <ul
      aria-label="Coverage legend"
      className="flex flex-wrap items-center gap-x-6 gap-y-3"
      style={{ listStyle: 'none', margin: 0, padding: 0 }}
    >
      <li className="instrument inline-flex items-center gap-2 text-nominal">
        <CoverageIcon kind="covered" />
        <span>COVERED · 7</span>
      </li>
      <li
        className="instrument inline-flex items-center gap-2"
        style={{ color: 'var(--status-inert)' }}
      >
        <CoverageIcon kind="inert" />
        <span>NOT TESTABLE · 3</span>
      </li>
      <li
        className="instrument inline-flex items-center gap-2"
        style={{ color: 'var(--status-inert)' }}
      >
        <CoverageIcon kind="addable" />
        <span>COULD BE ADDED LATER</span>
      </li>
    </ul>
  );
}
