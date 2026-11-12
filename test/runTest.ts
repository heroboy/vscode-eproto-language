import * as path from 'path';
import * as fs from 'fs';
import { runTests } from '@vscode/test-electron';

function getCandidateVSCodeExecutables(): string[] {
	const candidates: Array<string | undefined> = [
		process.env.VSCODE_EXECUTABLE_PATH,
		process.env.VSCODE_PATH,
		process.env.LOCALAPPDATA
			? path.join(process.env.LOCALAPPDATA, 'Programs', 'Microsoft VS Code', 'Code.exe')
			: undefined,
		process.env.LOCALAPPDATA
			? path.join(process.env.LOCALAPPDATA, 'Programs', 'Microsoft VS Code Insiders', 'Code - Insiders.exe')
			: undefined
	];

	return candidates.filter((p): p is string => !!p && fs.existsSync(p));
}

async function main(): Promise<void> {
	// compiled to out-test/test/runTest.js, so the repo root is two levels up
	const extensionDevelopmentPath = path.resolve(__dirname, '..', '..');
	const extensionTestsPath = path.resolve(__dirname, 'suite', 'index');
	const launchArgs = ['--disable-extensions'];

	const localCandidates = getCandidateVSCodeExecutables();
	if (localCandidates.length === 0) {
		throw new Error(
			'未找到本地 VS Code。请先安装 VS Code，或用 VSCODE_EXECUTABLE_PATH 指定 Code.exe。'
			+ '本测试脚本不会自动下载 VS Code。'
		);
	}

	const localExecutable = localCandidates[0];
	console.log(`[test] Using local VS Code: ${localExecutable}`);
	await runTests({
		vscodeExecutablePath: localExecutable,
		extensionDevelopmentPath,
		extensionTestsPath,
		launchArgs
	});
}

main().catch((err) => {
	console.error('Failed to run tests');
	console.error(err);
	process.exit(1);
});
