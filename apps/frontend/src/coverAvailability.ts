import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getCurrentLibrary } from "./api";

// CoverLocator/AuthorImageLocator's list-projection hasCover/hasImage flags only ever report true
// if the file is already sitting in the local cache mirror (see those types' own doc comments) -
// for a cloud-backed library, a cover/photo that exists remotely but hasn't been downloaded here
// yet would otherwise never even be requested, since every cover/avatar in this app is normally
// gated behind its hasCover/hasImage flag to avoid a needless request for books/authors that
// genuinely have none. So for a non-local library, always attempt the request instead of trusting
// the flag - the actual response (a real image, or a 404) decides from there.

export function useLibraryProviderType(): string | undefined {
  const libraryQuery = useQuery({ queryKey: ["library"], queryFn: getCurrentLibrary });
  return libraryQuery.data?.providerType;
}

/// Plain (non-hook) version for call sites that loop over several items (e.g. an author list) and
/// so can't call a hook per item - fetch providerType once via useLibraryProviderType() at the
/// component level, then call this inline per item instead.
export function shouldAttemptCloudAsset(hasFlag: boolean, providerType: string | undefined): boolean {
  return hasFlag || (providerType !== undefined && providerType !== "local");
}

/// Single-item hook version of shouldAttemptCloudAsset, for author/periodical Avatar-style usages
/// that don't need onError tracking - Mantine's Avatar already falls back to its placeholder
/// children automatically when its src 404s, so those call sites only need the "should we even
/// try" boolean, not the failed-state tracking useCoverAvailability (below) adds for plain <Image>
/// usages.
export function useShouldAttemptCloudAsset(hasFlag: boolean): boolean {
  const providerType = useLibraryProviderType();
  return shouldAttemptCloudAsset(hasFlag, providerType);
}

/// For plain Mantine <Image> usages (book/periodical covers) that fall back to a custom SpineCover
/// component rather than Image's own limited fallbackSrc - Image has no automatic "show children
/// on error" behavior, so the failed state has to be tracked explicitly here and reset whenever the
/// underlying id/version changes (list virtualizers can recycle the same component instance across
/// different rows).
export function useCoverAvailability(id: string, version: number | null | undefined, hasCover: boolean) {
  const providerType = useLibraryProviderType();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [id, version]);

  return {
    available: shouldAttemptCloudAsset(hasCover, providerType) && !failed,
    onError: () => setFailed(true),
  };
}
