import * as vscode from 'vscode';
import { EprParser2 } from './EprParser2';
import { EprFormatter } from './EprFormatter';
import { InitEprDocument } from './InitEprDocument';
import { compileEpr } from './compile';
import { activateEprStaff } from './EprParerStaff';

export function activate(context: vscode.ExtensionContext)
{
	//激活自动补全的一些功能
	activateEprStaff(context);

	//初始化文档命令
	context.subscriptions.push(
		vscode.commands.registerCommand('eproto.initDocument', InitEprDocument)
	);

	//格式化命令
	context.subscriptions.push(vscode.languages.registerDocumentFormattingEditProvider('eproto', {
		provideDocumentFormattingEdits(document, options, token)
		{
			let f = new EprFormatter(document, options);
			f.formatWholeDocument();
			return f.getEdits();
		},
	}));

	//编译命令
	context.subscriptions.push(
		vscode.commands.registerCommand('eproto.compileCurrentFile', () => compileEpr(context))
	);
}

export function deactivate() { }
