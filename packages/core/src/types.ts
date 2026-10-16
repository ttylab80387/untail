// ClearURLs provider format (subset we use), merged with our overrides.
export interface Provider {
  urlPattern: string;
  completeProvider?: boolean;
  rules?: string[];
  rawRules?: string[];
  referralMarketing?: string[];
  exceptions?: string[];
  redirections?: string[];
  forceRedirection?: boolean;
}

export interface Expander {
  match: string; // regex on the full URL
  loginWall?: { match: string; param: string }; // match: regex on the full URL of the login page
  normalizeHost?: Record<string, string>;
  shareId?: string; // regex on the path, capture group 1 = share ID
  firstHop?: boolean; // take the first redirect target without contacting it (e.g. a host blocked by DNS)
}

export type Locale = 'zh-TW' | 'en' | 'ja';
export type Category = 'sharer_id' | 'ad_click' | 'affiliate' | 'campaign' | 'session' | 'unknown';
export type Risk = 'high' | 'medium' | 'low';

export interface KnowledgeEntry {
  owner?: string;
  category: Category;
  risk: Risk;
  desc: Partial<Record<Locale, string>>;
}

export interface RuleBundle {
  schemaVersion: 1;
  version: string;
  providers: Record<string, Provider>;
  expanders: Record<string, Expander>;
  knowledge: Record<string, KnowledgeEntry>;
}

// A param or path segment removed from a URL, before analysis.
export interface RemovedItem {
  key: string; // param name, or "share-id" for path-based IDs
  value: string;
  host: string; // host of the URL it was removed from
}

export interface AnalyzedParam {
  key: string;
  value: string;
  owner?: string;
  category: Category;
  risk: Risk;
  desc?: string;
}

export type Status = 'clean' | 'partial' | 'failed';
export type ExpandFailure = 'expand_timeout' | 'unresolved' | 'network';
export type Reason = 'expand_disabled' | ExpandFailure | 'invalid_input';

export interface ProcessResult {
  originalUrl: string;
  cleanUrl: string;
  status: Status;
  reason?: Reason;
  removed: AnalyzedParam[];
  hops: string[];
}

// Where a link goes. host/domain are for display (Unicode); the ascii* forms are for comparison.
export interface SiteInfo {
  host: string;
  domain: string | null; // registrable domain; null for IPs and bare public suffixes
  asciiHost: string;
  asciiDomain: string | null;
  isIp: boolean;
}

export interface FetchInit {
  method: 'HEAD' | 'GET';
  headers: Record<string, string>;
  signal: AbortSignal;
  redirect: 'follow' | 'manual'; // manual: return the 3xx response itself with its Location
}

export interface FetchResponse {
  url: string;
  status: number;
  location?: string; // Location header of a 3xx response (manual redirect mode)
}

export type FetchFn = (url: string, init: FetchInit) => Promise<FetchResponse>;
