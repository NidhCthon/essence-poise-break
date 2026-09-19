/**
 * Poise & Break - The module's identity, shared by every other part of it.
 */

const MODULE_ID = "essence-poise-break";
const SYSTEM_ID = "exaltedessence";

/**
 * The system version whose condition modifiers targetNumbers() was checked
 * against. A different version is not a problem in itself - it is only the
 * context you want if a number ever disagrees with a roll.
 */
const VERIFIED_SYSTEM = "3.1.0";

const { ApplicationV2 } = foundry.applications.api;

/**
 * Is one of the module's effects on for this player? Each effect has its own
 * setting, and "Cinematic effects" switches them all off at once - for a slow
 * machine, or a quiet session - without losing how each was set.
 */
function effectEnabled(key) {
  try {
    if (game.settings.get(MODULE_ID, "cinematicEffects") === false) return false;
    return !!game.settings.get(MODULE_ID, key);
  } catch (err) {
    return false;
  }
}

export {
  ApplicationV2,
  effectEnabled,
  MODULE_ID,
  SYSTEM_ID,
  VERIFIED_SYSTEM
};
