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

export {
  ApplicationV2,
  MODULE_ID,
  SYSTEM_ID,
  VERIFIED_SYSTEM
};
