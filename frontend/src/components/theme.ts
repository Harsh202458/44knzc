import { useEffect, useState } from "react";

/** Resolve CSS custom properties to concrete colours (SVG attributes can't use var()). */
export function useThemeColors() {
  const read = () => {
    const s = getComputedStyle(document.documentElement);
    const v = (name: string) => s.getPropertyValue(name).trim();
    return {
      actual: v("--series-actual"),
      forecast: v("--series-forecast"),
      expected: v("--series-expected"),
      pos: v("--diverge-pos"),
      neg: v("--diverge-neg"),
      seq: v("--seq"),
      grid: v("--grid"),
      axis: v("--axis"),
      muted: v("--muted"),
      ink2: v("--ink-2"),
      surface: v("--surface"),
      surface2: v("--surface-2"),
    };
  };
  const [colors, setColors] = useState(read);
  useEffect(() => {
    const update = () => setColors(read());
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", update);
    const obs = new MutationObserver(update);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => {
      mq.removeEventListener("change", update);
      obs.disconnect();
    };
  }, []);
  return colors;
}

export type ThemeColors = ReturnType<typeof useThemeColors>;

/** Shared axis/grid props so every chart has the same quiet chrome. */
export function axisProps(c: ThemeColors) {
  return {
    stroke: c.axis,
    tick: { fill: c.muted, fontSize: 11 },
    tickLine: false,
  } as const;
}
