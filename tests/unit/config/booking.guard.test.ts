import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * THE BOOKING LINK HAS ONE HOME AND ONE RENDERER (P0).
 *
 * Only src/config/booking.ts may spell the Calendly host, and only it and
 * BookingLink may read the URL itself. A page that wants to know whether
 * booking is open imports `isBookingLive`, never the URL, so no page can draw
 * a booking anchor that skips the placeholder check or the new-tab attributes.
 */

function sourceFiles(dir: string): string[] {
  return readdirSync(join(process.cwd(), dir), { withFileTypes: true }).flatMap((entry) => {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) return sourceFiles(rel);
    return /\.(ts|tsx)$/.test(entry.name) ? [rel] : [];
  });
}

const read = (file: string) => readFileSync(join(process.cwd(), file), 'utf8');

describe('booking link guard', () => {
  const files = sourceFiles('src');

  it('finds the two modules it guards', () => {
    expect(files).toContain('src/config/booking.ts');
    expect(files).toContain('src/components/hud/BookingLink.tsx');
  });

  it('no module but src/config/booking.ts types the Calendly host', () => {
    const offenders = files
      .filter((file) => file !== 'src/config/booking.ts')
      .filter((file) => /calendly\.com/i.test(read(file)));
    expect(offenders).toEqual([]);
  });

  it('no module but BookingLink reads the booking URL', () => {
    const allowed = new Set(['src/config/booking.ts', 'src/components/hud/BookingLink.tsx']);
    const offenders = files
      .filter((file) => !allowed.has(file))
      .filter((file) => /\b(BOOKING_URL|bookingUrl|BOOKING_PLACEHOLDER)\b/.test(read(file)));
    expect(offenders).toEqual([]);
  });
});
