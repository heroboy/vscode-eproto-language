const { defineConfig } = require('@vscode/test-cli');

module.exports = defineConfig({
	files: 'out/test/suite/**/*.test.js',
	version: 'stable',
	cachePath: '.vscode-test-cache',
	mocha: {
		ui: 'tdd',
		timeout: 20000
	}
});
