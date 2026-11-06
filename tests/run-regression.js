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
	const root = path.resolve(__dirname, '..'); // repository root (serves tests/ and src/)
	const htmlPath = path.join(root, 'tests', 'regression.html');
	if (!fs.existsSync(htmlPath)) {
		throw new Error(`Regression harness not found: ${htmlPath}`);
	}
	// The harness rewrites the URL to /chat/... which browsers refuse on file:// — serve it over HTTP.
	const http = require('http');
	const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };
	const server = http.createServer((req, res) => {
		const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '');
		const file = path.join(root, rel);
		if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
			res.writeHead(404);
			return res.end();
		}
		res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
		fs.createReadStream(file).pipe(res);
	});
	await new Promise((r) => server.listen(0, '127.0.0.1', r));
	const port = server.address().port;
	const browser = await chromium.launch({ headless: true });
	try {
		const page = await browser.newPage();
		await page.goto(`http://127.0.0.1:${port}/tests/regression.html`);
		await page.waitForSelector('#results', { timeout: 5000 });
		await page.waitForTimeout(2000);
		const status = await page.evaluate(() => document.body.dataset.regressionStatus || 'unknown');
		const report = await page.evaluate(() => document.getElementById('results')?.textContent || '');
		console.log(report);
		if (status !== 'passed') {
			throw new Error(`Regression harness failed with status: ${status}`);
		}
		console.log('Regression harness passed.');
	} finally {
		await browser.close();
		server.close();
	}
}

main().catch((err) => {
	console.error(err.message || String(err));
	process.exit(1);
});
