export interface DistroSecurityManifest {
  extensionAllowlist?: string;
  models?: string;
}

export interface DistroBundleInfo {
  present: boolean;
  version?: string;
  featureToggles?: Record<string, boolean>;
  security?: DistroSecurityManifest;
}
