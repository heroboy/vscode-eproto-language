import * as path from 'path';
import Mocha = require('mocha');

const mocha = new Mocha({
	ui: 'tdd',
	timeout: 20000,
	color: true
});

mocha.addFile(path.resolve(__dirname, 'TmLanguage.test.js'));

mocha.run((failures: number) => {
	if (failures > 0) {
		console.error(`${failures} 个语法测试失败。`);
		process.exitCode = 1;
	}
});
