import * as vscode from 'vscode';


/*
此函数被注册为vscode的一个命令。用于初始化一个epr文件。
首先要检查当前文件是不是epr。如果当前文件不是epr文件，则这个命令根本不应该被显示出来。
在文件开头添加类似于以下内容：

protoname=TestProto;
protoid=101;
interfacestyle=stdcsgame;
serverlanguage=cpp;
csharpeventstyle=default;
notWriteDate=1;

要求：已经有的项目不要添加，protoname根据文件名来。其它项就按照这个固定值。
*/
export function InitEprDocument()
{
	const editor = vscode.window.activeTextEditor;
	if (!editor)
	{
		vscode.window.showWarningMessage('No active editor');
		return;
	}

	const document = editor.document;
	if (document.languageId !== 'eproto')
	{
		vscode.window.showWarningMessage('Not an epr file');
		return;
	}

	const text = document.getText();
	const keys = ['protoname', 'protoid', 'interfacestyle', 'serverlanguage', 'csharpeventstyle', 'notWriteDate'];
	const keySet = new Set(keys);
	const existing = new Set<string>();
	const re = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=.*$/gm;
	let m: RegExpExecArray | null;
	while ((m = re.exec(text)) !== null)
	{
		// 仅记录我们关心的 key
		if (keySet.has(m[1])) existing.add(m[1]);
	}

	const linesToAdd: string[] = [];
	if (!existing.has('protoname'))
	{
		const fileNameOnly = document.fileName.replace(/^.*[\\/]/, '');
		const base = fileNameOnly.replace(/\.[^/.]+$/, '');
		linesToAdd.push(`protoname=${base};`);
	}
	if (!existing.has('protoid')) linesToAdd.push('protoid=101;');
	if (!existing.has('interfacestyle')) linesToAdd.push('interfacestyle=stdcsgame;');
	if (!existing.has('serverlanguage')) linesToAdd.push('serverlanguage=cpp;');
	if (!existing.has('csharpeventstyle')) linesToAdd.push('csharpeventstyle=default;');
	if (!existing.has('notWriteDate')) linesToAdd.push('notWriteDate=1;');

	if (linesToAdd.length === 0)
	{
		vscode.window.showInformationMessage('EPR header already initialized');
		return;
	}

	const edit = new vscode.WorkspaceEdit();
	const insert = new vscode.Position(0, 0);
	const payload = linesToAdd.join('\n') + '\n\n';
	edit.insert(document.uri, insert, payload);
	vscode.workspace.applyEdit(edit).then(ok =>
	{
		if (ok) vscode.window.showInformationMessage('Initialized EPR header');
		else vscode.window.showErrorMessage('Failed to insert EPR header');
	});
}