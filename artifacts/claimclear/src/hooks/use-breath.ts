import * as React from "react";
import { useTransientFlag, useTransientFlagSet } from "@/hooks/use-transient-flag";

// Save-confirmation "breath" microinteraction (Task #316).
//
// A ~250ms one-shot animation used in place of a generic "Saved" toast on
// small/routine save sites (notes, inline edits, evidence metadata,
// decision-tree narrative tweaks). The CSS class lives in `index.css`
// (.animate-cc-breath) and combines a small scale-down + soft success
// tint, with a `prefers-reduced-motion` variant that drops the scale and
// only tints. The button is briefly disabled while `breathing` is true so
// it can't be double-clicked mid-animation.
//
// Internals delegate to the framework's `useTransientFlag` (Task #509);
// this hook is the thin semantic wrapper that adds the
// `animate-cc-breath` class-name convention and the "save" naming.
const BREATH_DURATION_MS = 250;

export interface UseBreathResult {
  /** True while the animation is playing. Use to disable the button. */
  breathing: boolean;
  /** Call on a successful routine save to play the animation. */
  trigger: () => void;
  /** Class name to spread onto the button (empty when not breathing). */
  className: string;
}

export function useBreath(): UseBreathResult {
  const { active, fire } = useTransientFlag(BREATH_DURATION_MS);
  return {
    breathing: active,
    trigger: fire,
    className: active ? "animate-cc-breath" : "",
  };
}

/* ------------------------------------------------------------------ */
/* Bulk-action shimmer (Task #494).                                    */
/*                                                                     */
/* Sibling of `useBreath` for row-level mutations. After a successful  */
/* bulk mutate, call `triggerForIds(ids)` and the matching rows pulse  */
/* the same soft success tint together for ~600ms — long enough to    */
/* read as one confirmed sweep across the table without dragging on.   */
/* `isBreathing(id)` returns the class name to spread onto each row    */
/* (empty string when not pulsing); the dedicated `cc-row-breath`     */
/* class lives in `index.css` and is reduced-motion aware (drops the  */
/* fade keyframe to a static tint flash).                              */
/*                                                                     */
/* Internals delegate to the framework's `useTransientFlagSet`         */
/* (Task #509); this hook is the thin semantic wrapper that adds the  */
/* `cc-row-breath` class-name convention.                              */
/* ------------------------------------------------------------------ */
const ROW_BREATH_DURATION_MS = 600;

export interface UseRowBreathResult<Id> {
  /** Returns the row class name when `id` is currently shimmering. */
  isBreathing: (id: Id) => boolean;
  /** Spread onto the row element; empty when not breathing. */
  rowClassName: (id: Id) => string;
  /** Play the shimmer for the given set of ids. */
  triggerForIds: (ids: ReadonlyArray<Id> | ReadonlySet<Id>) => void;
}

export function useRowBreath<Id>(): UseRowBreathResult<Id> {
  const { isActive, fire } = useTransientFlagSet<Id>(ROW_BREATH_DURATION_MS);
  const rowClassName = React.useCallback(
    (id: Id) => (isActive(id) ? "cc-row-breath" : ""),
    [isActive],
  );
  return { isBreathing: isActive, rowClassName, triggerForIds: fire };
}
