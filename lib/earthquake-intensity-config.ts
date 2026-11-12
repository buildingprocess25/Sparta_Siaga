/**
 * SPARTA SIAGA - Earthquake Intensity Configuration & Feature Flag
 * 
 * Safety: Feature flag defaults to false to prevent accidental activation in production.
 * Rule: Zero em dashes.
 */

let dynamicIntensityFlag: boolean | null = null;

export function isEarthquakeIntensityEnabled(): boolean {
  if (dynamicIntensityFlag !== null) {
    return dynamicIntensityFlag;
  }
  return process.env.EARTHQUAKE_INTENSITY_ENABLED === "true";
}

export function setEarthquakeIntensityEnabled(enabled: boolean | null): void {
  dynamicIntensityFlag = enabled;
}

export const EARTHQUAKE_INTENSITY_CONFIG = {
  // Candidate policy threshold: MMI >= 6.0 triggers auto-report draft
  candidateReportMmiThreshold: 6.0,
  // Fallback timeout before advisory escalation
  fallbackTimeoutMinutes: 30,
  // Controlled retry interval post-fallback timeout
  retryIntervalMinutes: 15,
  // Maximum backfill window
  maxBackfillMinutes: 1440,
  // Source providers
  supportedProviders: ["USGS", "BMKG"] as const,
};

