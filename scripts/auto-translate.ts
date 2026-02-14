#!/usr/bin/env node

import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { fileURLToPath } from "url";

interface TranslationMap {
  [key: string]: string | TranslationMap;
}

interface StringToKeyMap {
  [string: string]: string;
}

interface LintIssue {
  file: string;
  line: number;
  string: string;
}

interface IssuesByFile {
  [filePath: string]: LintIssue[];
}

interface ReplacementResult {
  filesModified: number;
  stringsReplaced: number;
  skipped: number;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const localesDir = path.resolve(__dirname, "../src/locales");
const primaryLang = "es";

export function loadTranslations(): TranslationMap {
  const primary = JSON.parse(
    fs.readFileSync(path.join(localesDir, primaryLang, "translation.json"), "utf-8")
  );
  return primary;
}

export function createStringToKeyMap(translations: TranslationMap): StringToKeyMap {
  const map: StringToKeyMap = {};
  const visited = new Set<string>();

  function flatten(obj: TranslationMap, prefix = ""): void {
    Object.entries(obj).forEach(([key, value]) => {
      const fullKey = prefix ? `${prefix}.${key}` : key;
      if (typeof value === "object" && value !== null && !Array.isArray(value)) {
        flatten(value as TranslationMap, fullKey);
      } else if (typeof value === "string" && value.trim()) {
        if (!visited.has(value)) {
          map[value] = fullKey;
          visited.add(value);
        }
      }
    });
  }

  flatten(translations);
  return map;
}

export function parseLintOutput(lintOutput: string): LintIssue[] {
  const issues: LintIssue[] = [];
  const lines = lintOutput.split("\n");
  let currentFile: string | null = null;

  for (const line of lines) {
    const fileMatch = line.match(/^src\/.+\.(tsx?|jsx?)/);
    if (fileMatch) {
      currentFile = fileMatch[0];
      continue;
    }

    if (!currentFile) continue;

    const issueMatch = line.match(/^\s+(\d+):\s*Error: Found hardcoded string:\s*(.+)$/);
    if (issueMatch) {
      const lineNum = parseInt(issueMatch[1]);
      let stringValue = issueMatch[2];
      
      if ((stringValue.startsWith('"') && stringValue.endsWith('"')) ||
          (stringValue.startsWith("'") && stringValue.endsWith("'"))) {
        stringValue = stringValue.slice(1, -1);
      }

      issues.push({
        file: path.resolve(__dirname, "..", currentFile),
        line: lineNum,
        string: stringValue,
      });
    }
  }

  return issues;
}

export function hasUseTranslation(content: string): boolean {
  return /import\s+{\s*useTranslation\s*}\s+from\s+['"]react-i18next['"]/.test(content);
}

export function hasUseTranslationHook(content: string): boolean {
  return /const\s+{\s*t\s*}\s*=\s*useTranslation\(\)/.test(content);
}

export function addImportIfMissing(lines: string[]): string[] {
  if (!hasUseTranslation(lines.join("\n"))) {
    let insertIndex = 0;
    if (lines[0]?.includes('"use client"')) {
      insertIndex = 1;
    }
    lines.splice(insertIndex, 0, 'import { useTranslation } from "react-i18next";');
  }
  return lines;
}

export function addHookIfMissing(lines: string[]): string[] {
  if (hasUseTranslationHook(lines.join("\n"))) return lines;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    if (/^(export\s+)?function\s+\w+\s*\(/.test(line)) {
      for (let j = i; j < lines.length; j++) {
        if (lines[j].includes(") {")) {
          lines.splice(j + 1, 0, '    const { t } = useTranslation();', "");
          return lines;
        }
      }
    }

    if (/^export\s+const\s+\w+\s*=\s*\(/.test(line) || /^\s*const\s+\w+\s*=\s*\(/.test(line)) {
      for (let j = i; j < lines.length; j++) {
        if (lines[j].includes(") => {")) {
          lines.splice(j + 1, 0, '    const { t } = useTranslation();', "");
          return lines;
        }
      }
    }
  }

  return lines;
}

export function attemptReplacement(lines: string[], lineIndex: number, oldString: string, translationKey: string): boolean {
  const line = lines[lineIndex];
  
  if (line.includes(oldString)) {
    const stringIndex = line.indexOf(oldString);
    const lineBeforeString = line.substring(0, stringIndex);
    
    if (/\w+="$/.test(lineBeforeString)) {
      lines[lineIndex] = line.replace(`"${oldString}"`, `{t("${translationKey}")}`);
      return true;
    }
    
    lines[lineIndex] = line.replace(oldString, `{t("${translationKey}")}`);
    return true;
  }
  
  return false;
}

export function replaceStringAtLine(lines: string[], lineNum: number, oldString: string, translationKey: string): boolean {
  let lineIndex = lineNum - 1;
  
  if (lineIndex >= 0 && lineIndex < lines.length && lines[lineIndex].includes(oldString)) {
    return attemptReplacement(lines, lineIndex, oldString, translationKey);
  }
  
  for (let offset = 1; offset <= 10; offset++) {
    if (lineIndex + offset < lines.length && lines[lineIndex + offset].includes(oldString)) {
      return attemptReplacement(lines, lineIndex + offset, oldString, translationKey);
    }
    const checkIndex = lineIndex - offset;
    if (checkIndex >= 0 && checkIndex < lines.length && lines[checkIndex].includes(oldString)) {
      return attemptReplacement(lines, checkIndex, oldString, translationKey);
    }
  }
  
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes(oldString)) {
      return attemptReplacement(lines, i, oldString, translationKey);
    }
  }
  
  return false;
}

export function groupIssuesByFile(issues: LintIssue[]): IssuesByFile {
  const issuesByFile: IssuesByFile = {};
  for (const issue of issues) {
    if (!issuesByFile[issue.file]) issuesByFile[issue.file] = [];
    issuesByFile[issue.file].push(issue);
  }
  return issuesByFile;
}

export function processFile(
  filePath: string,
  fileIssues: LintIssue[],
  stringToKeyMap: StringToKeyMap
): { lines: string[]; changed: boolean; replacements: number; skipped: number } {
  if (!fs.existsSync(filePath)) {
    return { lines: [], changed: false, replacements: 0, skipped: fileIssues.length };
  }

  let lines = fs.readFileSync(filePath, "utf-8").split("\n");
  let fileChanged = false;
  let stringsReplaced = 0;
  let skipped = 0;

  // Sort in reverse order to avoid line number shifting
  fileIssues.sort((a, b) => b.line - a.line);

  for (const issue of fileIssues) {
    const key = stringToKeyMap[issue.string];
    if (!key) {
      skipped++;
      continue;
    }

    if (replaceStringAtLine(lines, issue.line, issue.string, key)) {
      stringsReplaced++;
      fileChanged = true;
    } else {
      skipped++;
    }
  }

  if (fileChanged) {
    lines = addImportIfMissing(addHookIfMissing(lines));
  }

  return { lines, changed: fileChanged, replacements: stringsReplaced, skipped };
}

export async function runAutoTranslate(lintCommand: string = "pnpm i18n:lint 2>&1"): Promise<ReplacementResult> {
  const translations = loadTranslations();
  const stringToKeyMap = createStringToKeyMap(translations);

  let lintOutput: string;
  try {
    lintOutput = execSync(lintCommand, { encoding: "utf-8" });
  } catch (e: any) {
    lintOutput = e.stdout || e.message;
  }

  const issues = parseLintOutput(lintOutput);
  const issuesByFile = groupIssuesByFile(issues);

  let filesModified = 0;
  let stringsReplaced = 0;
  let skipped = 0;

  for (const [filePath, fileIssues] of Object.entries(issuesByFile)) {
    const result = processFile(filePath, fileIssues, stringToKeyMap);
    
    if (result.changed) {
      fs.writeFileSync(filePath, result.lines.join("\n"), "utf-8");
      filesModified++;
    }
    
    stringsReplaced += result.replacements;
    skipped += result.skipped;
  }

  return { filesModified, stringsReplaced, skipped };
}

async function main(): Promise<void> {
  console.log("🚀 Starting i18n string replacement...\n");

  const translations = loadTranslations();
  const stringToKeyMap = createStringToKeyMap(translations);

  console.log(`✅ Loaded ${Object.keys(stringToKeyMap).length} translation keys\n`);

  let lintOutput: string;
  try {
    lintOutput = execSync("pnpm i18n:lint 2>&1", { encoding: "utf-8" });
  } catch (e: any) {
    lintOutput = e.stdout || e.message;
  }

  const issues = parseLintOutput(lintOutput);
  console.log(`📍 Found ${issues.length} hardcoded strings\n`);

  const issuesByFile = groupIssuesByFile(issues);

  let filesModified = 0;
  let stringsReplaced = 0;
  let skipped = 0;

  for (const [filePath, fileIssues] of Object.entries(issuesByFile)) {
    const result = processFile(filePath, fileIssues, stringToKeyMap);
    
    if (result.changed) {
      fs.writeFileSync(filePath, result.lines.join("\n"), "utf-8");
      filesModified++;
    }
    
    stringsReplaced += result.replacements;
    skipped += result.skipped;
  }

  console.log(`\n📊 Summary: ${filesModified} files, ${stringsReplaced} replaced, ${skipped} skipped`);
}

if (import.meta.url === fileURLToPath(import.meta.url)) {
  main().catch(console.error);
}
