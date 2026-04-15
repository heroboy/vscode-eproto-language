import * as vscode from 'vscode';

const COMPILE_OUTPUT = vscode.window.createOutputChannel('EPR Compile');

function getParentDirFsPath(fileFsPath: string): string
{
	const slash = Math.max(fileFsPath.lastIndexOf('/'), fileFsPath.lastIndexOf('\\'));
	if (slash <= 0) return fileFsPath;
	return fileFsPath.substring(0, slash);
}

export async function compileEpr(context: vscode.ExtensionContext): Promise<void>
{
	const editor = vscode.window.activeTextEditor;
	if (!editor)
	{
		vscode.window.showErrorMessage('没有活动的编辑器');
		return;
	}

	const document = editor.document;
	if (document.languageId !== 'eproto' || !document.fileName.toLowerCase().endsWith('.epr'))
	{
		vscode.window.showErrorMessage('当前文件不是 epr 文件');
		return;
	}

	if (document.uri.scheme !== 'file')
	{
		vscode.window.showErrorMessage('当前 epr 文件必须是本地磁盘文件');
		return;
	}

	if (document.isUntitled)
	{
		vscode.window.showErrorMessage('请先保存 epr 文件');
		return;
	}

	if (document.isDirty)
	{
		const saved = await document.save();
		if (!saved)
		{
			vscode.window.showErrorMessage('保存已取消，编译中止');
			return;
		}
	}

	const compilerUri = vscode.Uri.joinPath(context.extensionUri, 'compiler', 'eProtoCompilerExeV2.exe');
	try
	{
		await vscode.workspace.fs.stat(compilerUri);
	}
	catch
	{
		vscode.window.showErrorMessage(`找不到编译器：${compilerUri.fsPath}`);
		return;
	}

	const eprFilePath = document.uri.fsPath;
	const cwd = getParentDirFsPath(eprFilePath);

	COMPILE_OUTPUT.clear();
	COMPILE_OUTPUT.show(true);
	COMPILE_OUTPUT.appendLine(`Compiler: ${compilerUri.fsPath}`);
	COMPILE_OUTPUT.appendLine(`Input: ${eprFilePath}`);
	COMPILE_OUTPUT.appendLine(`Working directory: ${cwd}`);
	COMPILE_OUTPUT.appendLine('--- 开始编译（输出见终端）---');

	const execution = new vscode.ProcessExecution(compilerUri.fsPath, [eprFilePath], {
		cwd,
	});
	const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
	const taskScope: vscode.TaskScope | vscode.WorkspaceFolder = workspaceFolder ?? vscode.TaskScope.Workspace;
	const task = new vscode.Task(
		{ type: 'process', task: 'eprotoCompileCurrent' },
		taskScope,
		'EPR: Compile Current File',
		'eproto',
		execution
	);
	task.presentationOptions = {
		reveal: vscode.TaskRevealKind.Always,
		panel: vscode.TaskPanelKind.Shared,
		focus: true,
		clear: true,
	};

	let taskExecution: vscode.TaskExecution;
	try
	{
		taskExecution = await vscode.tasks.executeTask(task);
	}
	catch (err)
	{
		const msg = err instanceof Error ? err.message : String(err);
		COMPILE_OUTPUT.appendLine(`--- 编译器启动失败：${msg} ---`);
		vscode.window.showErrorMessage(`编译器启动失败：${msg}`);
		return;
	}

	await new Promise<void>((resolve) =>
	{
		const d1 = vscode.tasks.onDidEndTaskProcess(e =>
		{
			if (e.execution !== taskExecution) return;
			d1.dispose();
			d2.dispose();
			if (e.exitCode === 0)
			{
				COMPILE_OUTPUT.appendLine('--- 编译成功 ---');
				vscode.window.showInformationMessage('EPR 编译完成');
			}
			else
			{
				COMPILE_OUTPUT.appendLine(`--- 编译失败（退出码：${e.exitCode ?? '未知'}）---`);
				vscode.window.showErrorMessage(`EPR 编译失败（退出码：${e.exitCode ?? '未知'}）`);
			}
			resolve();
		});

		const d2 = vscode.tasks.onDidEndTask(e =>
		{
			if (e.execution !== taskExecution) return;
			d1.dispose();
			d2.dispose();
			resolve();
		});
	});
}