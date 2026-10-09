/**
 * The tab title of a report that resolves. Without one the tab read the site
 * default, so every open report looked like the home page in a tab strip. A
 * compromised run has a fix report; a clean run has a result and nothing to fix.
 */
export function reportTitle(report: { readonly compromised: boolean }): string {
  return report.compromised ? 'Fix report · MCProof' : 'Run result · MCProof';
}
