import type { DistroBundleInfo } from "@/shared/types/distro";

export const DISTRO_FEATURE_SETTINGS_V2 = "settings_v2";

export function isDistroFeatureEnabled(
  distro: DistroBundleInfo | null | undefined,
  feature: string,
): boolean {
  if (!distro?.present) {
    return false;
  }

  return distro.featureToggles?.[feature] === true;
}
