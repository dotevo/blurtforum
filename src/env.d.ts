/// <reference types="vite/client" />

// Allow dynamic property access on window
interface Window {
  [key: string]: unknown;
  app?: { openProfile: (username: string) => void };
  __bfPlayerEnabled?: boolean;
  YT?: import('./modules/player').YTNamespace;
  onYouTubeIframeAPIReady?: () => void;
  PeerTubePlayer?: new (iframe: HTMLElement) => import('./modules/player').PTPlayer;
  whalevault?: import('./modules/whalevault').WVPublicInterface;
  wv_set_polyfill?: (walletName: string, useCid: string, useUrl: string) => void;
  steem_keychain?: Record<string, unknown>;
  hive_keychain?: Record<string, unknown>;
  blurt_keychain?: Record<string, unknown>;
}
