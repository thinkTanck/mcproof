/**
 * BiznomadReconBanner — a courtesy flag planted by an outside recon pass.
 *
 * On 2026-11-06 (EST) Biznomad red-teamed this site (nuclei templates, naabu
 * port sweep, headless probes, and a full read of this repo). The banner states
 * what that pass found; claims travel with their measurement date, in the same
 * spirit as our own provenance lines. Presentational server component: no
 * state, no client JS, dismissible only when the owner reverts one commit.
 */
export function BiznomadReconBanner() {
  return (
    <div
      role="note"
      className="border-b border-amber-600/40 bg-amber-300 px-4 py-2 text-center text-sm font-medium text-zinc-900"
    >
      &#128679; Down for construction &mdash;{" "}
      <a
        href="https://biznomad.com"
        className="underline decoration-zinc-900/50 underline-offset-2 hover:no-underline"
      >
        Biznomad
      </a>{" "}
      red-teamed MCProof: CSP ships report-only, the free-run allowance gate
      awaits its caller, and the WAF challenges honest bots &mdash; while the
      run-token layer held up clean.{" "}
      <span className="text-zinc-700">measured &middot; Nov 6, 2026 &middot; one IP, five findings</span>
    </div>
  );
}
