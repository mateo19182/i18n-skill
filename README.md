# i18n-opencode-skill

OpenCode skill for managing i18n translations using i18next-cli.

## Installation

```bash
cd your-frontend-project
npm install i18n-opencode-skill --save-dev
# or
pnpm add i18n-opencode-skill -D
```

## Setup

1. Install peer dependencies:
```bash
npm install i18next react-i18next
```

2. Configure your `package.json` scripts:
```json
{
  "scripts": {
    "i18n:lint": "i18next-cli lint",
    "i18n:extract": "i18next-cli extract",
    "i18n:status": "i18next-cli status",
    "i18n:sync": "i18next-cli sync",
    "i18n:add": "tsx node_modules/i18n-opencode-skill/scripts/add-translation.ts",
    "i18n:translate": "tsx node_modules/i18n-opencode-skill/scripts/auto-translate.ts"
  }
}
```

3. Configure i18next-cli in your project (e.g., `i18next.config.js`):
```javascript
export default {
  locales: ['en', 'es'],
  output: 'src/locales',
  // ... other config
};
```

## Usage

### Find hardcoded strings
```bash
pnpm i18n:lint
```

### Add translation keys
```bash
# Interactive
pnpm i18n:add

# CLI
pnpm i18n:add "common.loading" "Loading..."
```

### Auto-translate hardcoded strings
```bash
pnpm i18n:translate
```

This parses lint output, maps strings to translation keys from your primary locale, and replaces hardcoded strings with `t("key")` calls. It also adds `useTranslation` import and hook if missing.

### Sync keys across languages
```bash
pnpm i18n:sync
```

## CLI Commands

You can also use the CLI directly:

```bash
# Add translation
npx i18n-add

# Auto-translate
npx i18n-translate
```

## Requirements

- i18next >= 20.0.0
- react-i18next >= 12.0.0
- Node.js >= 18.0.0
- TypeScript/TSX for running TypeScript scripts

## License

MIT
