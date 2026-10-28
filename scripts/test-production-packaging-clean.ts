import fs from 'fs';
import path from 'path';

interface PackagingAssertion {
  id: string;
  category: string;
  target: string;
  expectedInPackage: boolean;
  reason: string;
}

function matchesPattern(filePath: string, pattern: string): boolean {
  const normalizedFile = filePath.replace(/\\/g, '/');
  const normalizedPattern = pattern.trim().replace(/\\/g, '/');

  if (normalizedPattern.startsWith('#') || !normalizedPattern) return false;

  // Exact directory match
  if (normalizedFile === normalizedPattern || normalizedFile.startsWith(normalizedPattern + '/')) {
    return true;
  }

  // Wildcard match (simple glob)
  const regexStr = '^' + normalizedPattern
    .replace(/\./g, '\\.')
    .replace(/\*\*/g, '.*')
    .replace(/(?<!\.)\*/g, '[^/]*')
    .replace(/\?/g, '[^/]') + '($|/.*)';
  
  const regex = new RegExp(regexStr);
  return regex.test(normalizedFile);
}

function isExcludedByDockerignore(filePath: string, rules: string[]): boolean {
  let excluded = false;
  const normalizedFile = filePath.replace(/\\/g, '/');

  for (const rule of rules) {
    const trimmed = rule.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    if (trimmed.startsWith('!')) {
      const positivePattern = trimmed.substring(1);
      if (matchesPattern(normalizedFile, positivePattern)) {
        excluded = false;
      }
    } else {
      if (matchesPattern(normalizedFile, trimmed)) {
        excluded = true;
      }
    }
  }

  return excluded;
}

async function runPackagingVerification() {
  console.log('================================================================================');
  console.log(' SPARTA SIAGA — PROD-CLEAN-01: PRODUCTION PACKAGING VERIFICATION SUITE');
  console.log('================================================================================\n');

  const dockerignoreContent = fs.readFileSync('.dockerignore', 'utf8');
  const dockerignoreRules = dockerignoreContent.split('\n');

  const testCases: PackagingAssertion[] = [
    // 1. INC-TEST Photos (Requirement 4)
    {
      id: 'PKG-01',
      category: 'TEST_PHOTOS',
      target: 'public/uploads/progress/orig_INC-TEST-PROG-001_1791275049561_sn995k.png',
      expectedInPackage: false,
      reason: '92 INC-TEST progress photos must be excluded from production image',
    },
    {
      id: 'PKG-02',
      category: 'TEST_PHOTOS',
      target: 'public/uploads/progress/wm_INC-TEST-PROG-001_1791255158511_xg4kol.png',
      expectedInPackage: false,
      reason: 'Watermarked INC-TEST progress photos must be excluded from production image',
    },
    // 2. Demo / UAT Simulation data (Requirement 4)
    {
      id: 'PKG-03',
      category: 'SIMULATION_DATA',
      target: 'public/simulasi-uat/01_foto_kejadian_awal_toko.jpg',
      expectedInPackage: false,
      reason: 'Demo / UAT simulation photos must be excluded from production image',
    },
    {
      id: 'PKG-04',
      category: 'SIMULATION_DATA',
      target: 'public/simulasi-uat/03_dokumen_ceklis_10_toko.pdf',
      expectedInPackage: false,
      reason: 'Demo / UAT simulation PDF documents must be excluded from production image',
    },
    // 3. Playwright browser specs (Requirement 4)
    {
      id: 'PKG-05',
      category: 'PLAYWRIGHT_ARTIFACTS',
      target: 'tests/browser/auth-login.spec.ts',
      expectedInPackage: false,
      reason: 'Playwright test suites must be excluded from production image',
    },
    {
      id: 'PKG-06',
      category: 'PLAYWRIGHT_ARTIFACTS',
      target: 'playwright.config.ts',
      expectedInPackage: false,
      reason: 'Playwright configuration must be excluded from production image',
    },
    // 4. Standalone and temporary QA scripts (Requirement 2 & 4)
    {
      id: 'PKG-07',
      category: 'TEST_SCRIPTS',
      target: 'test-api.mjs',
      expectedInPackage: false,
      reason: 'Root test-api.mjs script must be excluded from production image',
    },
    {
      id: 'PKG-08',
      category: 'TEST_SCRIPTS',
      target: 'scripts/test-earthquake-automatic-reporting-eq03.ts',
      expectedInPackage: false,
      reason: 'Non-production test script must be excluded from production image',
    },
    {
      id: 'PKG-09',
      category: 'TEST_SCRIPTS',
      target: 'scripts/capture-all-four-tasks.ts',
      expectedInPackage: false,
      reason: 'Screenshot capture automation script must be excluded from production image',
    },
    // 5. Preserved Production Scripts (Requirement 5)
    {
      id: 'PKG-10',
      category: 'PROD_MIGRATION',
      target: 'scripts/migrate-production.mjs',
      expectedInPackage: true,
      reason: 'Production database migration runner MUST be preserved in production packaging',
    },
    {
      id: 'PKG-11',
      category: 'PROD_DAEMON',
      target: 'scripts/worker-daemon.ts',
      expectedInPackage: true,
      reason: 'Standalone autonomous daemon runner MUST be preserved in production packaging',
    },
    {
      id: 'PKG-21', category: 'PROD_SUPERVISOR',
      target: 'scripts/supervise-web-worker.mjs', expectedInPackage: true,
      reason: 'Combined supervisor ships in production',
    },
    {
      id: 'PKG-22', category: 'PROD_HEALTH',
      target: 'scripts/health-combined.mjs', expectedInPackage: true,
      reason: 'Combined healthcheck ships in production',
    },
    // 6. Documentation, QA reports, Graphify (Requirement 2)
    {
      id: 'PKG-12',
      category: 'DOCUMENTATION',
      target: 'docs/README.md',
      expectedInPackage: false,
      reason: 'Project documentation must be excluded from production image',
    },
    {
      id: 'PKG-13',
      category: 'QA_REPORT',
      target: 'sparta_p1_qa_report.md',
      expectedInPackage: false,
      reason: 'Standalone QA report must be excluded from production image',
    },
    {
      id: 'PKG-14',
      category: 'GRAPHIFY',
      target: 'graphify-out/graph.json',
      expectedInPackage: false,
      reason: 'Graphify persistent knowledge graph must be excluded from production image',
    },
    // 7. Sensitive & Environment Files (Requirement 8)
    {
      id: 'PKG-15',
      category: 'SECRETS',
      target: '.env.local',
      expectedInPackage: false,
      reason: 'Local environment secrets must NEVER be packaged into production image',
    },
    {
      id: 'PKG-16',
      category: 'SECRETS',
      target: '.env.example',
      expectedInPackage: true,
      reason: 'Clean template environment file is safely packaged',
    },
    // 8. Legitimate Production Assets (Requirement 6)
    {
      id: 'PKG-17',
      category: 'PROD_ASSETS',
      target: 'public/manifest.json',
      expectedInPackage: true,
      reason: 'PWA Web Manifest must be present in production image',
    },
    {
      id: 'PKG-18',
      category: 'PROD_ASSETS',
      target: 'public/sw.js',
      expectedInPackage: true,
      reason: 'Service Worker script must be present in production image',
    },
    {
      id: 'PKG-19',
      category: 'PROD_DATA',
      target: 'data/stores-master.csv',
      expectedInPackage: true,
      reason: 'Master stores dataset must be present in production image',
    },
    {
      id: 'PKG-20',
      category: 'PROD_SCHEMA',
      target: 'database/schema.sql',
      expectedInPackage: true,
      reason: 'Production database schema definitions must be present in production image',
    },
  ];

  let passCount = 0;
  let failCount = 0;

  for (const tc of testCases) {
    const isExcluded = isExcludedByDockerignore(tc.target, dockerignoreRules);
    const inPackage = !isExcluded;
    const passed = inPackage === tc.expectedInPackage;

    if (passed) {
      passCount++;
      console.log(`✔ [PASS] [${tc.id}] ${tc.category}: ${tc.target} -> In Package: ${inPackage} (${tc.reason})`);
    } else {
      failCount++;
      console.error(`❌ [FAIL] [${tc.id}] ${tc.category}: ${tc.target} -> Expected in package: ${tc.expectedInPackage}, got: ${inPackage}`);
    }
  }

  // Section 2: Audit real INC-TEST files on disk
  console.log('\n--- SECTION 2: Disk Audit for INC-TEST Photos ---');
  let realIncTestCount = 0;
  const progressDir = path.resolve('public', 'uploads', 'progress');
  if (fs.existsSync(progressDir)) {
    const files = fs.readdirSync(progressDir);
    realIncTestCount = files.filter(f => f.includes('INC-TEST')).length;
  }
  console.log(`Audit result: Found ${realIncTestCount} INC-TEST photos in public/uploads/progress/ (Expected: 92)`);
  const incTestAuditPass = realIncTestCount === 92;
  console.log(`Status: ${incTestAuditPass ? '✔ PASS' : '❌ FAIL'} (All 92 photos accounted for and excluded by packaging rules)`);

  // Section 3: Diagnostic Endpoint Security Check (Requirement 7)
  console.log('\n--- SECTION 3: Diagnostic Endpoint Security Check ---');
  const pushTestRouteContent = fs.readFileSync('app/api/notifications/push/test/route.ts', 'utf8');
  const hasAdminCheck = pushTestRouteContent.includes('sessionUser.systemRole !== "ADMIN"');
  console.log(`Status: ${hasAdminCheck ? '✔ PASS' : '❌ FAIL'} (app/api/notifications/push/test restricts access strictly to ADMIN)`);

  // Section 4: Dockerfile Defense-in-depth Check
  console.log('\n--- SECTION 4: Dockerfile Multi-stage Prune Check ---');
  const dockerfileContent = fs.readFileSync('Dockerfile', 'utf8');
  const hasDefensivePrune = dockerfileContent.includes('public/simulasi-uat') && 
                            dockerfileContent.includes('orig_INC-TEST*') &&
                            dockerfileContent.includes('tests');
  console.log(`Status: ${hasDefensivePrune ? '✔ PASS' : '❌ FAIL'} (Dockerfile contains defensive pre-build pruning)`);

  console.log('\n================================================================================');
  console.log(` PACKAGING VERIFICATION RECAP: ${passCount} passed, ${failCount} failed`);
  console.log('================================================================================\n');

  if (failCount > 0 || !incTestAuditPass || !hasAdminCheck || !hasDefensivePrune) {
    process.exit(1);
  }
}

runPackagingVerification().catch((e) => {
  console.error(e);
  process.exit(1);
});
