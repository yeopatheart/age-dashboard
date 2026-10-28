import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // 브라우저 콘솔에 붙여넣어 쓰는 수동 점검 도구(CLAUDE.md의 글자 잘림 점검). 모듈이 아니라서 린트 대상에서 뺀다.
    "scripts/text-clip-audit.js",
  ]),
]);

export default eslintConfig;
