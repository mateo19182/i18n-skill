import prompts from 'prompts';
import fs from 'fs-extra';
import set from 'lodash.set';
import path from 'path';

const args = process.argv.slice(2);

const localesDir = 'src/locales';
const langs = ['en', 'es'];
const file = 'translation.json';

(async () => {
  let keyPath: string;
  let translations: Record<string, string>;

  if (args.length >= 2) {
    keyPath = args[0];
    translations = {};
    langs.forEach((lang, i) => {
      translations[lang] = args[i + 1] || args[1] || '';
    });
  } else {
    ({ keyPath } = await prompts([
      { name: 'keyPath', type: 'text', message: 'Full key path (e.g., common.submitNew):' },
    ]));

    if (!keyPath) {
      console.log('❌ Key path is required');
      process.exit(1);
    }

    translations = { en: '' };

    const enResult = await prompts({
      type: 'text',
      name: 'value',
      message: 'English value:',
    });
    translations.en = enResult.value || '';

    for (const lang of langs.slice(1)) {
      translations[lang] = await prompts({
        type: 'text',
        name: 'value',
        message: `${lang.toUpperCase()} (${translations.en || '??'}):`,
        initial: translations.en,
      }).then((r) => r.value);
    }
  }

  for (const [lang, value] of Object.entries(translations)) {
    const filePath = path.join(localesDir, lang, file);
    const data = await fs.readJson(filePath).catch(() => ({}));
    set(data, keyPath, value);
    await fs.writeJson(filePath, data, { spaces: 2 });
    console.log(`✅ Added "${keyPath}" to ${lang}`);
  }
})();
