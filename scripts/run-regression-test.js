const fs = require('fs');
const path = require('path');
let chromium;
try {
	({ chromium } = require('playwright'));
} catch {
	console.error('Playwright is not installed. Install it to run regression checks: npm i -D playwright');
	process.exit(1);
}

async function main() {
	const root = path.resolve(__dirname, '..');
	const htmlPath = path.join(root, 'tests', 'regression.html');
	if (!fs.existsSync(htmlPath)) {
		throw new Error(`Regression harness not found: ${htmlPath}`);
	}
	const browser = await chromium.launch({ headless: true });
	try {
		const page = await browser.newPage();
		await page.goto(`file:///${htmlPath.replace(/\\/g, '/')}`);
		await page.waitForSelector('#results', { timeout: 5000 });
		await page.waitForTimeout(1400);
		const status = await page.evaluate(() => document.body.dataset.regressionStatus || 'unknown');
		const report = await page.evaluate(() => document.getElementById('results')?.textContent || '');
		console.log(report);
		if (status !== 'passed') {
			throw new Error(`Regression harness failed with status: ${status}`);
		}
		console.log('Regression harness passed.');
	} finally {
		await browser.close();
	}
}

main().catch((err) => {
	console.error(err.message || String(err));
	process.exit(1);
});
