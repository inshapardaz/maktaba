const COMPLETE_KEY = "maktaba-onboarding-complete";

export function hasCompletedOnboarding(): boolean {
  if (typeof window === "undefined") {
    return true;
  }
  return window.localStorage.getItem(COMPLETE_KEY) === "true";
}

export function markOnboardingComplete(): void {
  window.localStorage.setItem(COMPLETE_KEY, "true");
}
