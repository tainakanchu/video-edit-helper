/** XML 特殊文字をエスケープする (& を先に処理) */
export function escapeXml(s: string): string {
  // & → &amp;  < → &lt;  > → &gt;  " → &quot;  ' → &apos;
  // & must be first to avoid double-escaping
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}
