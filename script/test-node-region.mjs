import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

// 在内存中加载真实地区处理逻辑，避免为测试引入额外依赖。
async function loadTypeScript(path) {
  const source = await readFile(new URL(path, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
  });
  return import(`data:text/javascript;base64,${Buffer.from(compiled.outputText).toString("base64")}`);
}

const { buildRegionOverridePatch, getRegionCode, getRegionFlag } = await loadTypeScript("../src/lib/nodeRegion.ts");
const { getSupportedRegions, isRegionMatch } = await loadTypeScript("../src/utils/regionHelper.ts");

test("manual changes normalize country codes before saving", () => {
  assert.deepEqual(buildRegionOverridePatch("", true, " de "), { region_override: "DE" });
  assert.deepEqual(buildRegionOverridePatch("DE", true, "jp"), { region_override: "JP" });
});

test("unrelated edits omit the field and preserve another administrator's update", () => {
  const unchanged = buildRegionOverridePatch("DE", true, " de ");
  assert.deepEqual(unchanged, {});
  assert.deepEqual({ region_override: "JP", ...unchanged }, { region_override: "JP" });
  assert.deepEqual(buildRegionOverridePatch(undefined, false, ""), {});
  assert.deepEqual(buildRegionOverridePatch(null, false, ""), {});
});

test("switching to automatic explicitly clears an existing override", () => {
  assert.deepEqual(buildRegionOverridePatch("DE", false, "JP"), { region_override: "" });
  assert.deepEqual(buildRegionOverridePatch("", false, "invalid draft"), {});
});

test("manual mode rejects empty, malformed and non-ASCII inputs", () => {
  for (const input of ["", " ", "D", "DEU", "D1", "D E", "德国", "🇩🇪", "ｄｅ", "ſa", "DE;JP"]) {
    assert.equal(buildRegionOverridePatch("", true, input), null, input);
  }
});

test("two-letter codes outside the local suggestion list reach server validation", () => {
  // 前端不把111项推荐列表当成完整地区列表，合法性由服务端判定。
  assert.deepEqual(buildRegionOverridePatch("", true, "ax"), { region_override: "AX" });
  assert.deepEqual(buildRegionOverridePatch("", true, "zz"), { region_override: "ZZ" });
});

test("flag conversion preserves supported regions and normalizes code input", () => {
  assert.equal(getRegionCode(" de "), "DE");
  assert.equal(getRegionCode("🇩🇪"), "DE");
  assert.equal(getRegionFlag("de"), "🇩🇪");
  for (const flag of getSupportedRegions()) {
    const code = getRegionCode(flag);
    assert.match(code, /^[A-Z]{2}$/);
    assert.equal(getRegionFlag(code), flag);
  }
  for (const invalid of ["", "🌐", "🇩", "🇩🇪🇯", "DEU", "DE;JP"]) {
    assert.equal(getRegionCode(invalid), null, invalid);
  }
  assert.equal(getRegionFlag("bad"), "");
});

test("region suggestions retain Chinese, English, code and alias search", () => {
  const flag = getRegionFlag("DE");
  for (const query of ["德国", "Germany", "DE"]) assert.equal(isRegionMatch(flag, query), true);
  assert.equal(isRegionMatch(getRegionFlag("US"), "america"), true);
  assert.equal(isRegionMatch(flag, "Japan"), false);
});
