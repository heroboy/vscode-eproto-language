import * as path from 'path';
import * as fs from 'fs';
import Mocha = require('mocha');

export async function run(): Promise<void> {
	// Create the mocha test
	const mocha = new Mocha({
		ui: 'tdd',
		color: true,
		timeout: 20000
	});

	const testsRoot = path.resolve(__dirname, '.');

	return new Promise((c, e) => {
		try {
			// Find all test files
			const files = fs.readdirSync(testsRoot)
				.filter((file: string) => file.endsWith('.test.js'));
			
			// Add files to the test suite
			files.forEach((file: string) => mocha.addFile(path.resolve(testsRoot, file)));

			// Run the mocha test
			mocha.run((failures: number) => {
				if (failures > 0) {
					e(new Error(`${failures} tests failed.`));
				} else {
					c();
				}
			});
		} catch (err: unknown) {
			e(err);
		}
	});
}
