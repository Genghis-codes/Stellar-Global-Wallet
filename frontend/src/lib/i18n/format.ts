/**
 * The ICU MessageFormat subset used by @globe-wallet/i18n catalogues:
 * `{name}`, `{n, plural, =0 {...} one {...} other {...}}` (with `#`) and
 * `{key, select, a {...} other {...}}`. Unknown placeholders are left as-is.
 */
export type MessageVars = Record<string, string | number>;

function matchBrace(s: string, open: number): number {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    if (s[i] === "{") depth++;
    else if (s[i] === "}" && --depth === 0) return i;
  }
  return -1;
}

function parseOptions(body: string): Map<string, string> {
  const options = new Map<string, string>();
  const re = /\s*(=?\w+)\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) {
    const open = m.index + m[0].length - 1;
    const close = matchBrace(body, open);
    if (close === -1) break;
    options.set(m[1] ?? "", body.slice(open + 1, close));
    re.lastIndex = close + 1;
  }
  return options;
}

export function formatMessage(template: string, vars: MessageVars = {}, locale = "en"): string {
  let out = "";
  let i = 0;
  while (i < template.length) {
    const open = template.indexOf("{", i);
    const close = open === -1 ? -1 : matchBrace(template, open);
    if (open === -1 || close === -1) return out + template.slice(i);
    out += template.slice(i, open);
    const [name = "", type, ...rest] = template.slice(open + 1, close).split(",");
    const key = name.trim();
    const has = Object.prototype.hasOwnProperty.call(vars, key);
    if (!has) {
      out += template.slice(open, close + 1);
    } else if (type === undefined) {
      out += String(vars[key]);
    } else {
      const options = parseOptions(rest.join(","));
      const value = vars[key]!;
      let chosen: string;
      if (type.trim() === "plural") {
        const n = Number(value);
        chosen =
          options.get(`=${n}`) ?? options.get(new Intl.PluralRules(locale).select(n)) ?? options.get("other") ?? "";
        chosen = chosen.replace(/#/g, new Intl.NumberFormat(locale).format(n));
      } else {
        chosen = options.get(String(value)) ?? options.get("other") ?? "";
      }
      out += formatMessage(chosen, vars, locale);
    }
    i = close + 1;
  }
  return out;
}
