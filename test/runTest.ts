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
	const extensionDevelopmentPath = path.resolve(__dirname, '..');
	const extensionTestsPath = path.resolve(__dirname, 'suite', 'index');
	const launchArgs = ['--disable-extensions'];

	const localCandidates = getCandidateVSCodeExecutables();
	if (localCandidates.length > 0) {
		const localExecutable = localCandidates[0];
		console.log(`[test] Using local VS Code: ${localExecutable}`);
		try {
			await runTests({
				vscodeExecutablePath: localExecutable,
				extensionDevelopmentPath,
				extensionTestsPath,
				launchArgs
			});
			return;
		} catch (err) {
			console.warn('[test] Local VS Code run failed, fallback to downloaded stable runtime.');
			console.warn(err);
		}
	}

	console.log('[test] No usable local VS Code found, fallback to stable downloaded runtime.');
	await runTests({
		extensionDevelopmentPath,
		extensionTestsPath,
		launchArgs,
		version: 'stable'
	});
}

main().catch((err) => {
	console.error('Failed to run tests');
	console.error(err);
	process.exit(1);
});
