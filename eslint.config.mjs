import js from "@eslint/js";
import tseslint from "typescript-eslint";

const toolingFiles = ["eslint.config.mjs", "vitest.workspace.ts", "apps/api/vitest.e2e.config.ts"];

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/.next/**",
      "**/coverage/**",
      "packages/database/drizzle/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: toolingFiles,
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: toolingFiles,
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ["eslint.config.mjs"],
    rules: {
      "@typescript-eslint/no-deprecated": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
    },
  },
  {
    files: ["scripts/*.mjs"],
    ...tseslint.configs.disableTypeChecked,
    languageOptions: {
      globals: {
        fetch: "readonly",
        Headers: "readonly",
        process: "readonly",
        setTimeout: "readonly",
      },
      parserOptions: {
        projectService: false,
      },
    },
  },
);
