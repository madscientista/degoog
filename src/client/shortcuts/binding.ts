import type { ShortcutBinding, ShortcutKind } from "../../shared/shortcuts";
import type { Shortcut } from "../utils/keyboard-shortcuts";

const PURE_MODIFIERS = new Set(["Control", "Alt", "Shift", "Meta"]);

const KEY_LABELS: Record<string, string> = {
  ArrowUp: "Up",
  ArrowDown: "Down",
  ArrowLeft: "Left",
  ArrowRight: "Right",
  " ": "Space",
  Escape: "Esc",
  Enter: "Enter",
};

export const isModifierOnly = (e: KeyboardEvent): boolean =>
  PURE_MODIFIERS.has(e.key);

export const eventToBinding = (e: KeyboardEvent): ShortcutBinding => ({
  key: e.key,
  ctrl: e.ctrlKey,
  meta: e.metaKey,
  alt: e.altKey,
  shift: e.shiftKey,
});

export const eventToModifiers = (e: KeyboardEvent): ShortcutBinding => ({
  ctrl: e.ctrlKey,
  meta: e.metaKey,
  alt: e.altKey,
  shift: e.shiftKey,
});

const _onApple = (): boolean =>
  typeof navigator !== "undefined" &&
  /mac|iphone|ipad|ipod/i.test(navigator.platform || navigator.userAgent);

const MAC_MODIFIERS = { ctrl: "⌃", alt: "⌥", shift: "⇧", meta: "⌘" } as const;
const PC_MODIFIERS = { ctrl: "Ctrl", alt: "Alt", shift: "Shift", meta: "Meta" } as const;

const _keyLabel = (key: string): string => {
  if (KEY_LABELS[key]) return KEY_LABELS[key];
  return key.length === 1 ? key.toUpperCase() : key;
};

export const formatBinding = (
  binding: ShortcutBinding,
  kind: ShortcutKind = "single",
): string => {
  const mods = _onApple() ? MAC_MODIFIERS : PC_MODIFIERS;
  const parts: string[] = [];
  if (binding.ctrl) parts.push(mods.ctrl);
  if (binding.alt) parts.push(mods.alt);
  if (binding.shift) parts.push(mods.shift);
  if (binding.meta) parts.push(mods.meta);
  if (kind === "numeric") {
    parts.push("1-9");
  } else if (binding.key) {
    parts.push(_keyLabel(binding.key));
  }
  return parts.join(" + ");
};

export const hasBinding = (binding: ShortcutBinding, kind: ShortcutKind): boolean => {
  if (kind === "numeric") {
    return Boolean(binding.ctrl || binding.alt || binding.shift || binding.meta);
  }
  return Boolean(binding.key);
};

export const toShortcut = (
  binding: ShortcutBinding,
  rest: Omit<Shortcut, "key" | "ctrl" | "meta" | "alt" | "shift">,
): Shortcut => ({
  key: binding.key ?? "",
  ctrl: binding.ctrl,
  meta: binding.meta,
  alt: binding.alt,
  shift: binding.shift,
  ...rest,
});
