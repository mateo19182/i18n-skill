import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  createStringToKeyMap,
  parseLintOutput,
  hasUseTranslation,
  hasUseTranslationHook,
  addImportIfMissing,
  addHookIfMissing,
  attemptReplacement,
  replaceStringAtLine,
  groupIssuesByFile,
  processFile,
} from '../scripts/auto-translate';

// Mock fs
vi.mock('fs', () => ({
  default: {
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
    existsSync: vi.fn(),
  },
}));

describe('createStringToKeyMap', () => {
  it('should create a flat map from nested translations', () => {
    const translations = {
      common: {
        submit: 'Submit',
        cancel: 'Cancel',
      },
      header: {
        title: 'Welcome',
      },
    };

    const result = createStringToKeyMap(translations);

    expect(result).toEqual({
      'Submit': 'common.submit',
      'Cancel': 'common.cancel',
      'Welcome': 'header.title',
    });
  });

  it('should handle flat translations', () => {
    const translations = {
      greeting: 'Hello',
      farewell: 'Goodbye',
    };

    const result = createStringToKeyMap(translations);

    expect(result).toEqual({
      'Hello': 'greeting',
      'Goodbye': 'farewell',
    });
  });

  it('should ignore empty strings', () => {
    const translations = {
      empty: '',
      whitespace: '   ',
      valid: 'Hello',
    };

    const result = createStringToKeyMap(translations);

    expect(result).toEqual({
      'Hello': 'valid',
    });
  });

  it('should use first occurrence for duplicate values', () => {
    const translations = {
      first: 'Duplicate',
      second: 'Duplicate',
    };

    const result = createStringToKeyMap(translations);

    expect(result).toEqual({
      'Duplicate': 'first',
    });
  });
});

describe('parseLintOutput', () => {
  it('should parse lint output with file and line info', () => {
    const lintOutput = `src/components/Button.tsx
    15: Error: Found hardcoded string: "Click me"
    20: Error: Found hardcoded string: 'Submit'

src/pages/Home.tsx
    5: Error: Found hardcoded string: "Welcome"`;

    const result = parseLintOutput(lintOutput);

    expect(result).toHaveLength(3);
    expect(result[0]).toMatchObject({
      line: 15,
      string: 'Click me',
    });
    expect(result[0].file).toContain('Button.tsx');
    expect(result[1]).toMatchObject({
      line: 20,
      string: 'Submit',
    });
    expect(result[2]).toMatchObject({
      line: 5,
      string: 'Welcome',
    });
  });

  it('should handle empty output', () => {
    const result = parseLintOutput('');
    expect(result).toEqual([]);
  });

  it('should handle output without issues', () => {
    const lintOutput = `src/components/Button.tsx
✅ No hardcoded strings found`;

    const result = parseLintOutput(lintOutput);
    expect(result).toEqual([]);
  });
});

describe('hasUseTranslation', () => {
  it('should detect useTranslation import', () => {
    const content = `import { useTranslation } from "react-i18next";
import React from "react";`;

    expect(hasUseTranslation(content)).toBe(true);
  });

  it('should detect useTranslation import with spaces', () => {
    const content = `import {  useTranslation  } from 'react-i18next';`;

    expect(hasUseTranslation(content)).toBe(true);
  });

  it('should return false when import is missing', () => {
    const content = `import React from "react";`;

    expect(hasUseTranslation(content)).toBe(false);
  });
});

describe('hasUseTranslationHook', () => {
  it('should detect useTranslation hook usage', () => {
    const content = `function MyComponent() {
      const { t } = useTranslation();
      return <div>{t('key')}</div>;
    }`;

    expect(hasUseTranslationHook(content)).toBe(true);
  });

  it('should detect hook with spaces', () => {
    const content = `const {  t  } = useTranslation();`;

    expect(hasUseTranslationHook(content)).toBe(true);
  });

  it('should return false when hook is missing', () => {
    const content = `function MyComponent() {
      return <div>Hello</div>;
    }`;

    expect(hasUseTranslationHook(content)).toBe(false);
  });
});

describe('addImportIfMissing', () => {
  it('should add import when missing', () => {
    const lines = ['import React from "react";', 'function Component() {}'];

    const result = addImportIfMissing(lines);

    expect(result[0]).toBe('import { useTranslation } from "react-i18next";');
    expect(result[1]).toBe('import React from "react";');
  });

  it('should add import after use client directive', () => {
    const lines = ['"use client"', 'import React from "react";'];

    const result = addImportIfMissing(lines);

    expect(result[0]).toBe('"use client"');
    expect(result[1]).toBe('import { useTranslation } from "react-i18next";');
  });

  it('should not duplicate import', () => {
    const lines = ['import { useTranslation } from "react-i18next";', 'function Component() {}'];

    const result = addImportIfMissing([...lines]);

    const importCount = result.filter(line => line.includes('useTranslation')).length;
    expect(importCount).toBe(1);
  });
});

describe('addHookIfMissing', () => {
  it('should add hook to function declaration', () => {
    const lines = [
      'function MyComponent() {',
      '  return <div>Hello</div>;',
      '}',
    ];

    const result = addHookIfMissing(lines);

    expect(result[1]).toBe('    const { t } = useTranslation();');
    expect(result[2]).toBe('');
  });

  it('should add hook to arrow function', () => {
    const lines = [
      'export const MyComponent = () => {',
      '  return <div>Hello</div>;',
      '};',
    ];

    const result = addHookIfMissing(lines);

    expect(result[1]).toBe('    const { t } = useTranslation();');
    expect(result[2]).toBe('');
  });

  it('should not duplicate hook', () => {
    const lines = [
      'function MyComponent() {',
      '  const { t } = useTranslation();',
      '  return <div>Hello</div>;',
      '}',
    ];

    const result = addHookIfMissing([...lines]);

    const hookCount = result.filter(line => line.includes('useTranslation()')).length;
    expect(hookCount).toBe(1);
  });
});

describe('attemptReplacement', () => {
  it('should replace string in JSX attribute', () => {
    const lines = ['<Button label="Click me" />'];

    const result = attemptReplacement(lines, 0, 'Click me', 'button.click');

    expect(result).toBe(true);
    expect(lines[0]).toBe('<Button label={t("button.click")} />');
  });

  it('should replace string in text content', () => {
    const lines = ['<div>Hello World</div>'];

    const result = attemptReplacement(lines, 0, 'Hello World', 'greeting.hello');

    expect(result).toBe(true);
    expect(lines[0]).toBe('<div>{t("greeting.hello")}</div>');
  });

  it('should return false when string not found', () => {
    const lines = ['<div>Hello World</div>'];

    const result = attemptReplacement(lines, 0, 'Not Found', 'key');

    expect(result).toBe(false);
  });
});

describe('replaceStringAtLine', () => {
  it('should replace at exact line', () => {
    const lines = ['line 1', '<div>Hello</div>', 'line 3'];

    const result = replaceStringAtLine(lines, 2, 'Hello', 'greeting');

    expect(result).toBe(true);
    expect(lines[1]).toBe('<div>{t("greeting")}</div>');
  });

  it('should search nearby lines if not found at exact line', () => {
    const lines = [
      'line 1',
      'line 2',
      '<div>Hello</div>',
      'line 4',
    ];

    const result = replaceStringAtLine(lines, 3, 'Hello', 'greeting');

    expect(result).toBe(true);
    expect(lines[2]).toBe('<div>{t("greeting")}</div>');
  });

  it('should search entire file as fallback', () => {
    const lines = ['line 1', 'line 2', 'line 3', '<div>Hello</div>'];

    const result = replaceStringAtLine(lines, 10, 'Hello', 'greeting');

    expect(result).toBe(true);
    expect(lines[3]).toBe('<div>{t("greeting")}</div>');
  });

  it('should return false when string not found anywhere', () => {
    const lines = ['line 1', 'line 2', 'line 3'];

    const result = replaceStringAtLine(lines, 2, 'Not Found', 'key');

    expect(result).toBe(false);
  });
});

describe('groupIssuesByFile', () => {
  it('should group issues by file path', () => {
    const issues = [
      { file: '/path/file1.tsx', line: 1, string: 'a' },
      { file: '/path/file1.tsx', line: 2, string: 'b' },
      { file: '/path/file2.tsx', line: 1, string: 'c' },
    ];

    const result = groupIssuesByFile(issues);

    expect(Object.keys(result)).toHaveLength(2);
    expect(result['/path/file1.tsx']).toHaveLength(2);
    expect(result['/path/file2.tsx']).toHaveLength(1);
  });

  it('should handle empty array', () => {
    const result = groupIssuesByFile([]);

    expect(result).toEqual({});
  });
});

describe('processFile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should process and replace strings in file', () => {
    const filePath = '/test/file.tsx';
    const fileIssues = [
      { file: filePath, line: 2, string: 'Hello' },
    ];
    const stringToKeyMap = { 'Hello': 'greeting.hello' };

    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(
      'import React from "react";\nfunction Component() {\n  return <div>Hello</div>;\n}'
    );

    const result = processFile(filePath, fileIssues, stringToKeyMap);

    expect(result.changed).toBe(true);
    expect(result.replacements).toBe(1);
    expect(result.lines.join('\n')).toContain('useTranslation');
    expect(result.lines.join('\n')).toContain('{t("greeting.hello")}');
  });

  it('should skip when translation key not found', () => {
    const filePath = '/test/file.tsx';
    const fileIssues = [
      { file: filePath, line: 2, string: 'Unknown String' },
    ];
    const stringToKeyMap = { 'Hello': 'greeting.hello' };

    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue('function Component() {}');

    const result = processFile(filePath, fileIssues, stringToKeyMap);

    expect(result.changed).toBe(false);
    expect(result.skipped).toBe(1);
    expect(result.replacements).toBe(0);
  });

  it('should handle non-existent file', () => {
    const filePath = '/test/nonexistent.tsx';
    const fileIssues = [
      { file: filePath, line: 1, string: 'Hello' },
    ];
    const stringToKeyMap = { 'Hello': 'greeting.hello' };

    vi.mocked(fs.existsSync).mockReturnValue(false);

    const result = processFile(filePath, fileIssues, stringToKeyMap);

    expect(result.changed).toBe(false);
    expect(result.skipped).toBe(1);
  });
});
