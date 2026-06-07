---
name: Gating a selling channel
description: Every UI surface that must be covered when feature-gating a sales channel (eBay etc.), incl. the easy-to-miss locked/initial fallbacks.
---

# Gating a selling channel (eBay-style)

Add the channel to `FEATURE_GATE_DEFAULTS` (server) and gate ALL of these client surfaces with `useFeature('<key>')`. BrickLink/BrickOwl are deliberately NOT in the gate catalog, so they stay always-visible — gate conditions must be channel-key-scoped, never broad.

Surfaces that must be gated together (missing one = a leak):
1. Dashboard "Uplink" selling-channels panel — the locked `ChannelSyncPanel channel="<ch>"`.
2. ChannelSyncPanel channel switcher — filter the channel out of `allDisplayChannels` when hidden.
3. SettingsModal Platforms — both the nav entry AND the detail section.
4. Auto-sync rows in SettingsModal — already connection-guarded (`*ConnectedL`), so a non-opted org with no connection won't see them.

**Non-obvious trap:** ChannelSyncPanel's `displayChannels` has a fallback that re-synthesizes a *locked* channel even after it's filtered out of `allDisplayChannels`. So filtering the switcher list is NOT enough. You must also:
- Hard-deny: `if (lockedChannel === '<ch>' && !show<Ch>) return null;` placed with the other early returns (after all main-body hooks — the deep `useQuery` calls live in nested components, not the main body).
- Guard the initial-select effect so it won't pick the hidden channel.
- Normalize `selectedChannel` off the hidden channel to `brickowl` so sync mutations (which default to `selectedChannel`) never target a gated channel.

**Why:** an architect review caught that gating only the parent + switcher still let `channel="ebay"` / `initialChannel='ebay'` resurface eBay and fire sync actions.

**Migration note:** pure feature-flag gating (consistent with all other gated features) means an org that previously connected the channel but isn't opted into the beta loses the UI — opt those orgs in rather than adding a connection bypass.
