// tests/browser/support/reportFlaky — NO SILENT RETRIES. In CI a browser test gets one retry
// (playwright.config.ts says why), and a test that fails and then passes leaves the run green. This
// reads the run's own report and raises a GitHub warning naming every such test, so a green deploy
// with a flaky test in it says so on its summary page. It never fails the run: the retry already
// decided that. (.github/workflows/deploy.yml runs it straight after the tests.)
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT } from './builtSite.js'

const REPORT = join(ROOT, 'test-results', 'report.json')

// Every test in the report that Playwright scored 'flaky', as "project › file › title".
const flakyIn = (suite, file = suite.file) => [
  ...(suite.specs ?? []).flatMap((spec) =>
    spec.tests
      .filter((t) => t.status === 'flaky')
      .map((t) => `${t.projectName} › ${file} › ${spec.title}`),
  ),
  ...(suite.suites ?? []).flatMap((inner) => flakyIn(inner, inner.file ?? file)),
]

if (!existsSync(REPORT)) {
  // The tests never ran far enough to write one (the lane refused a stale build, say). That step
  // has already failed with its own reason; there is nothing to add.
  console.log('browser lane: no report to read.')
} else {
  const flaky = JSON.parse(readFileSync(REPORT, 'utf8')).suites.flatMap((suite) => flakyIn(suite))
  for (const name of flaky)
    console.log(
      `::warning title=Flaky browser test::${name} failed, then passed on its retry. ` +
        `Its trace is in this run's browser-test-results artifact. A flaky test is a defect: fix it.`,
    )
  console.log(`browser lane: ${flaky.length} test(s) needed a retry.`)
}
