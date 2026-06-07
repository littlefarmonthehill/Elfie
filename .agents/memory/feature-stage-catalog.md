---
name: Feature stage catalog for hidden-feature awareness
description: Why /api/features exposes a `catalog` of all gated stages, and the onboarding three-stage rule
---

# Effective-stage catalog vs. visible/stages

`/api/features` (getVisibleFeatures) returns `visible`, `stages` (visible-only),
AND `catalog` — the effective stage of EVERY gated feature regardless of the
caller's visibility.

**Why:** `visible`/`stages` only include features the current user can see. A
normal (non-super-admin) user never sees alpha features and only sees beta ones
they've opted into. So any UART run by normal users that must *reason about* a
hidden feature's stage (notably the OnboardingWizard) cannot use `stages` — it
needs `catalog`. The effective stage = code default in FEATURE_GATE_DEFAULTS,
overridden per-env by a productCapabilities row with the same featureKey.

**How to apply:** In onboarding, the three-stage rule is:
- released → offer normally, no opt-in
- beta → offer it AND opt the org into the beta key (POST /api/settings/beta-features {key,enable:true}) when the user sets it up
- alpha (or 'none') → remove from onboarding entirely

Two granularities of removal: per-item (filter a channel out of its step, e.g.
eBay/channel_ebay) and whole-step (a step that exists only to set up one gated
feature, e.g. Warehouse→inv_cargo_bay — skip via a STEP_FEATURE map +
nextVisibleStep + visibleSteps progress filter). Onboarding nav is forward-only.

**Gotcha:** gate fail-CLOSED while `useFeatures().isLoading` — treat an
unknown gated key as hidden during load so an alpha feature never flashes in;
fall back to 'released' only once loaded. Add a safety effect that force-advances
off the current step if it becomes hidden after the catalog resolves.
