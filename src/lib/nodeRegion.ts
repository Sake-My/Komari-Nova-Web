// 覆盖值使用两字母代码；公开的 region 仍使用旗帜 emoji。
const normalizeRegionCode = (value: string): string | null => {
  const trimmed = value.trim();
  return /^[a-zA-Z]{2}$/.test(trimmed) ? trimmed.toUpperCase() : null;
};

export const getRegionCode = (region: string): string | null => {
  const code = normalizeRegionCode(region);
  if (code) return code;
  const points = Array.from(region.trim(), (character) => character.codePointAt(0)!);
  if (points.length !== 2 || points.some((point) => point < 0x1f1e6 || point > 0x1f1ff)) {
    return null;
  }
  return String.fromCharCode(...points.map((point) => point - 0x1f1e6 + 65));
};

export const getRegionFlag = (code: string): string => {
  const normalized = normalizeRegionCode(code);
  return normalized
    ? String.fromCodePoint(...Array.from(normalized, (letter) => letter.charCodeAt(0) - 65 + 0x1f1e6))
    : "";
};

// null 表示手动值格式错误；空对象表示未改变，不覆盖其他管理员的新值。
export const buildRegionOverridePatch = (
  original: string | null | undefined,
  manual: boolean,
  input: string,
): { region_override?: string } | null => {
  const next = manual ? normalizeRegionCode(input) : "";
  if (next === null) return null;
  const previous = (original ?? "").trim().toUpperCase();
  return next === previous ? {} : { region_override: next };
};
