import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const contractsDistPath = path.resolve(__dirname, '../../packages/contracts/dist/index.js');
if (!fs.existsSync(contractsDistPath)) {
  console.error(`ERROR: Contracts dist file not found at ${contractsDistPath}. Please run build first.`);
  process.exit(1);
}

const contractsDistUrl = pathToFileURL(contractsDistPath).href;
const { validatePlan } = await import(contractsDistUrl);

let hasError = false;

const validPlanPath = path.resolve(__dirname, '../../examples/phase-1/valid-plan.json');
console.log(`[VALID PLAN CHECK] Reading ${path.basename(validPlanPath)}...`);
try {
  const validPlanContent = JSON.parse(fs.readFileSync(validPlanPath, 'utf8'));
  const result = validatePlan(validPlanContent);
  if (result.success) {
    console.log(`  ✓ PASS: valid-plan.json is valid (success: true)`);
  } else {
    console.error(`  ✗ FAIL: valid-plan.json failed validation:`, result.issues);
    hasError = true;
  }
} catch (err) {
  console.error(`  ✗ ERROR reading valid-plan.json:`, err);
  hasError = true;
}

const expectedResultsPath = path.resolve(__dirname, '../../examples/phase-1/expected-results.json');
let expectedResults = {};
if (fs.existsSync(expectedResultsPath)) {
  expectedResults = JSON.parse(fs.readFileSync(expectedResultsPath, 'utf8'));
} else {
  console.warn(`[WARNING] expected-results.json not found at ${expectedResultsPath}`);
}

const invalidDir = path.resolve(__dirname, '../../examples/phase-1/invalid');
console.log(`\n[INVALID PLAN CHECKS] Reading directory ${invalidDir}...`);

const invalidFiles = fs.readdirSync(invalidDir).filter(f => f.endsWith('.json'));
if (invalidFiles.length === 0) {
  console.error(`  ✗ FAIL: No invalid sample files found in ${invalidDir}`);
  hasError = true;
}

for (const file of invalidFiles) {
  const filePath = path.join(invalidDir, file);
  try {
    const content = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const result = validatePlan(content);

    if (result.success) {
      console.error(`  ✗ FAIL [${file}]: Expected validation to fail, but got success: true`);
      hasError = true;
      continue;
    }

    const actualIssueCodes = result.issues.map(i => i.code);
    const expectedCodes = expectedResults[file] || [];

    let matched = false;
    if (expectedCodes.length > 0) {
      matched = expectedCodes.some(code => actualIssueCodes.includes(code));
    } else {
      matched = true;
    }

    if (matched) {
      console.log(`  ✓ PASS [${file}]: Rejected as expected.`);
      console.log(`         Actual issue codes: ${actualIssueCodes.join(', ')}`);
    } else {
      console.error(`  ✗ FAIL [${file}]: Issues did not match expectation.`);
      console.error(`         Expected one of: ${expectedCodes.join(', ')}`);
      console.error(`         Actual issue codes: ${actualIssueCodes.join(', ')}`);
      hasError = true;
    }
  } catch (err) {
    console.error(`  ✗ ERROR processing ${file}:`, err);
    hasError = true;
  }
}

console.log('\n==================================================');
if (hasError) {
  console.error('RESULT: FAILED sample validation checks.');
  process.exit(1);
} else {
  console.log('RESULT: ALL sample validation checks PASSED.');
  process.exit(0);
}
