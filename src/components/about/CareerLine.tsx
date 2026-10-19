import { CAREER_NODES } from '@/lib/about/copy';
import { Reveal } from './Reveal';

/**
 * THE CAREER SIGNAL LINE (owner ruling 2026-10-18). A line that draws from the
 * first node to the last when scrolled into view and spikes once at each of
 * four nodes. Horizontal from 768px, vertical below it: both are drawn and CSS
 * shows the one that fits, so nothing reflows on hydration. The labels are a
 * real ordered list, never SVG text, and the drawing is decoration.
 *
 * The four nodes sit at the centres of four equal columns (12.5%, 37.5%,
 * 62.5%, 87.5%), so each spike is under its label at any width.
 */
const CENTRES = [50, 150, 250, 350];

function horizontalPath(): string {
  let d = 'M0 36';
  for (const x of CENTRES) d += ` L${x - 7} 36 L${x} 6 L${x + 7} 36`;
  return `${d} L400 36`;
}

function verticalPath(): string {
  let d = 'M14 0';
  for (const y of CENTRES) d += ` L14 ${y - 7} L34 ${y} L14 ${y + 7}`;
  return `${d} L14 400`;
}

export function CareerLine() {
  return (
    <Reveal name="career" className="relative mt-10">
      <div data-career-line="">
        <svg
          data-orientation="horizontal"
          aria-hidden="true"
          viewBox="0 0 400 44"
          preserveAspectRatio="none"
          className="hidden h-11 w-full md:block"
        >
          <path
            className="career-path"
            pathLength={1}
            d={horizontalPath()}
            fill="none"
            stroke="var(--status-nominal)"
            strokeWidth={1.5}
            vectorEffect="non-scaling-stroke"
            strokeLinejoin="round"
          />
        </svg>
        <div className="relative">
          <svg
            data-orientation="vertical"
            aria-hidden="true"
            viewBox="0 0 40 400"
            preserveAspectRatio="none"
            className="absolute inset-y-0 left-0 h-full w-10 md:hidden"
          >
            <path
              className="career-path"
              pathLength={1}
              d={verticalPath()}
              fill="none"
              stroke="var(--status-nominal)"
              strokeWidth={1.5}
              vectorEffect="non-scaling-stroke"
              strokeLinejoin="round"
            />
          </svg>
          <ol
            aria-label="Career"
            className="grid grid-rows-4 pl-14 md:grid-cols-4 md:grid-rows-none md:pl-0"
          >
            {CAREER_NODES.map((label) => (
              <li
                key={label}
                className="reading flex min-h-20 items-center text-ink md:min-h-0 md:justify-center md:pt-3 md:text-center"
              >
                {label}
              </li>
            ))}
          </ol>
        </div>
      </div>
      {/* The line goes on into the roadmap, dashed because that part is not
          built: from the last node down, at the right on a desk and at the
          left on a phone. */}
      <div
        aria-hidden="true"
        data-career-continues=""
        className="ml-[13px] h-12 w-px border-l border-dashed border-nominal/60 md:ml-[87.5%]"
      />
    </Reveal>
  );
}
