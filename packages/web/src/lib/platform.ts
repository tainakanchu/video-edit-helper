export type OsKind = 'windows' | 'mac' | 'linux'

/**
 * 実行中の OS を判定する。WebView / ブラウザの OS = 素材があるマシンの OS。
 * (WSL でもブラウザ側は Windows と判定されるため、Windows パス例が出て実態と合う)
 */
export function detectOs(): OsKind {
  const ua = (typeof navigator !== 'undefined' ? navigator.userAgent : '').toLowerCase()
  if (ua.includes('win')) return 'windows'
  if (ua.includes('mac') || ua.includes('iphone') || ua.includes('ipad')) return 'mac'
  return 'linux'
}

/** メディアフォルダの絶対パス例(OS 別) */
export function mediaPathExample(os: OsKind = detectOs()): string {
  switch (os) {
    case 'windows':
      return 'D:\\Footage\\Taiwan'
    case 'mac':
      return '/Volumes/Footage/Taiwan'
    default:
      return '/home/you/footage/Taiwan'
  }
}
