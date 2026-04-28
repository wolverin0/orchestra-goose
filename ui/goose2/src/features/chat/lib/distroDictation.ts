import type {
  DictationProvider,
  DictationProviderStatus,
} from "@/shared/types/dictation";

export function filterDictationProvidersForDistro(
  providers: Partial<Record<DictationProvider, DictationProviderStatus>>,
): Partial<Record<DictationProvider, DictationProviderStatus>> {
  return providers;
}
