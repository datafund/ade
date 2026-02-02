#!/usr/bin/env bun
/**
 * Code review script - analyzes staged changes before commit.
 *
 * Usage:
 *   bun scripts/review.ts          # Review staged changes
 *   bun scripts/review.ts --all    # Review all uncommitted changes
 */

import { $ } from "bun";

interface ReviewIssue {
  severity: "error" | "warning" | "info";
  file: string;
  line?: number;
  message: string;
  suggestion?: string;
}

const issues: ReviewIssue[] = [];

function addIssue(issue: ReviewIssue) {
  issues.push(issue);
}

// Get changed files
async function getChangedFiles(all: boolean): Promise<string[]> {
  const cmd = all ? "git diff --name-only" : "git diff --cached --name-only";
  const result = await $`${cmd.split(" ")}`.text();
  return result.trim().split("\n").filter(f => f.length > 0);
}

// Get file diff
async function getFileDiff(file: string, all: boolean): Promise<string> {
  const cmd = all ? `git diff ${file}` : `git diff --cached ${file}`;
  try {
    const result = await $`${cmd.split(" ")}`.text();
    return result;
  } catch {
    return "";
  }
}

// Check for common issues in TypeScript/JavaScript files
function reviewTypeScript(file: string, diff: string) {
  const lines = diff.split("\n");
  let lineNum = 0;

  for (const line of lines) {
    // Track line numbers from diff headers
    const lineMatch = line.match(/^@@ -\d+,?\d* \+(\d+)/);
    if (lineMatch) {
      lineNum = parseInt(lineMatch[1], 10) - 1;
      continue;
    }

    if (line.startsWith("+") && !line.startsWith("+++")) {
      lineNum++;
      const content = line.slice(1);

      // Check for console.log (should be console.error for CLI output)
      if (content.includes("console.log") && !file.includes("test")) {
        addIssue({
          severity: "warning",
          file,
          line: lineNum,
          message: "console.log used - CLI should use console.error for status messages",
          suggestion: "Use console.error for user-facing messages, stdout for data output",
        });
      }

      // Check for hardcoded secrets patterns
      if (/(['"])(0x)?[a-fA-F0-9]{64}\1/.test(content) && !file.includes("test")) {
        addIssue({
          severity: "error",
          file,
          line: lineNum,
          message: "Possible hardcoded secret or private key detected",
          suggestion: "Use keychain or environment variables for secrets",
        });
      }

      // Check for any/unknown types
      if (/: any\b/.test(content)) {
        addIssue({
          severity: "warning",
          file,
          line: lineNum,
          message: "'any' type used - consider using a more specific type",
        });
      }

      // Check for TODO/FIXME without issue reference
      if (/\/\/\s*(TODO|FIXME|HACK)\b/i.test(content) && !/#\d+/.test(content)) {
        addIssue({
          severity: "info",
          file,
          line: lineNum,
          message: "TODO/FIXME comment without issue reference",
          suggestion: "Consider linking to a GitHub issue",
        });
      }

      // Check for process.exit without error handling
      if (content.includes("process.exit") && !content.includes("process.exit(0)")) {
        addIssue({
          severity: "info",
          file,
          line: lineNum,
          message: "process.exit with non-zero code",
          suggestion: "Ensure proper error message is shown before exit",
        });
      }

      // Check for synchronous file operations
      if (/\b(readFileSync|writeFileSync|existsSync)\b/.test(content)) {
        addIssue({
          severity: "info",
          file,
          line: lineNum,
          message: "Synchronous file operation used",
          suggestion: "Consider using async versions for better performance",
        });
      }

      // Check for missing error handling in catch blocks
      if (/catch\s*\(\s*\)/.test(content) || /catch\s*\{\s*\}/.test(content)) {
        addIssue({
          severity: "warning",
          file,
          line: lineNum,
          message: "Empty or ignored catch block",
          suggestion: "Handle or log the error appropriately",
        });
      }
    } else if (line.startsWith(" ")) {
      lineNum++;
    }
  }
}

// Check for common issues in JSON files
function reviewJSON(file: string, diff: string) {
  if (file === "package.json") {
    // Check for version changes
    if (diff.includes('"version"')) {
      addIssue({
        severity: "info",
        file,
        message: "Version changed in package.json",
        suggestion: "Ensure CHANGELOG is updated if needed",
      });
    }

    // Check for new dependencies
    if (diff.includes('"dependencies"') || diff.includes('"devDependencies"')) {
      addIssue({
        severity: "info",
        file,
        message: "Dependencies changed",
        suggestion: "Run 'bun install' and verify package-lock is committed",
      });
    }
  }
}

// Main review function
async function review() {
  const args = process.argv.slice(2);
  const all = args.includes("--all");

  console.error("🔍 Reviewing changes...\n");

  const files = await getChangedFiles(all);

  if (files.length === 0) {
    console.error("No changes to review.");
    console.error(all ? "No uncommitted changes." : "No staged changes. Use --all to review all changes.");
    process.exit(0);
  }

  console.error(`Files to review: ${files.length}\n`);

  for (const file of files) {
    const diff = await getFileDiff(file, all);
    if (!diff) continue;

    // Route to appropriate reviewer based on file type
    if (file.endsWith(".ts") || file.endsWith(".js") || file.endsWith(".tsx") || file.endsWith(".jsx")) {
      reviewTypeScript(file, diff);
    } else if (file.endsWith(".json")) {
      reviewJSON(file, diff);
    }
  }

  // Run type check
  console.error("Running type check...");
  try {
    await $`bun run tsc --noEmit`.quiet();
    console.error("✓ Type check passed\n");
  } catch {
    addIssue({
      severity: "error",
      file: "(project)",
      message: "TypeScript compilation failed",
      suggestion: "Run 'bun run tsc --noEmit' to see errors",
    });
  }

  // Run tests
  console.error("Running tests...");
  try {
    // Run only unit tests (not chain-view which hits rate limits)
    await $`bun test tests/errors.test.ts tests/format.test.ts tests/api.test.ts tests/routing.test.ts tests/help.test.ts tests/escrow-keys.test.ts tests/commands.test.ts tests/addresses.test.ts tests/secrets.test.ts tests/keychain/keychain.test.ts tests/update.test.ts tests/integration.test.ts`.quiet();
    console.error("✓ Tests passed\n");
  } catch {
    addIssue({
      severity: "error",
      file: "(project)",
      message: "Tests failed",
      suggestion: "Run 'bun test' to see failures",
    });
  }

  // Output results
  if (issues.length === 0) {
    console.error("✅ No issues found. Ready to commit!\n");
    process.exit(0);
  }

  // Group by severity
  const errors = issues.filter(i => i.severity === "error");
  const warnings = issues.filter(i => i.severity === "warning");
  const infos = issues.filter(i => i.severity === "info");

  console.error(`\n📋 Review Results: ${errors.length} errors, ${warnings.length} warnings, ${infos.length} info\n`);

  const printIssue = (issue: ReviewIssue) => {
    const icon = issue.severity === "error" ? "❌" : issue.severity === "warning" ? "⚠️" : "ℹ️";
    const loc = issue.line ? `${issue.file}:${issue.line}` : issue.file;
    console.error(`${icon} ${loc}`);
    console.error(`   ${issue.message}`);
    if (issue.suggestion) {
      console.error(`   💡 ${issue.suggestion}`);
    }
    console.error();
  };

  if (errors.length > 0) {
    console.error("─── Errors ───");
    errors.forEach(printIssue);
  }

  if (warnings.length > 0) {
    console.error("─── Warnings ───");
    warnings.forEach(printIssue);
  }

  if (infos.length > 0) {
    console.error("─── Info ───");
    infos.forEach(printIssue);
  }

  // Exit with error if there are errors
  if (errors.length > 0) {
    console.error("❌ Fix errors before committing.\n");
    process.exit(1);
  }

  console.error("⚠️ Review warnings before committing.\n");
  process.exit(0);
}

review().catch(err => {
  console.error("Review failed:", err.message);
  process.exit(1);
});
