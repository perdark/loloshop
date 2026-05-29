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
  ]),
  {
    rules: {
      // False-positive on the standard on-mount data-fetch idiom
      // (useEffect(() => { setLoading(true); fetch().then(setState) }, [dep])).
      // The React-compiler hooks rule flags it but it's the correct pattern for
      // loading remote data; refactoring 7 loaders adds risk for no gain. Off.
      "react-hooks/set-state-in-effect": "off",
      // Intentionally-unused identifiers are marked with a leading underscore.
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          ignoreRestSiblings: true,
        },
      ],
      // Allow `fn?.() ?? fallback()` short-circuit calls as statements.
      "@typescript-eslint/no-unused-expressions": [
        "warn",
        { allowShortCircuit: true, allowTernary: true },
      ],
    },
  },
]);

export default eslintConfig;
