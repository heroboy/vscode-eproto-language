import * as vscode from 'vscode';
import { EprFormatter } from './EprFormatter';
import { InitEprDocument } from './InitEprDocument';
import { compileEpr } from './compile';
import { activateEprParserStaff } from './EprParserStaff';
import { measureCallback } from './Perf';

export function activate(context: vscode.ExtensionContext)
{
	//补全、自动 tag、调试命令等
	activateEprParserStaff(context);

	//初始化文档命令
	context.subscriptions.push(
		vscode.commands.registerCommand('eproto.initDocument', InitEprDocument)
	);

	//格式化命令
	context.subscriptions.push(vscode.languages.registerDocumentFormattingEditProvider('eproto', {
		provideDocumentFormattingEdits(document, options, token)
		{
			return measureCallback(
				'provideDocumentFormattingEdits',
				() =>
				{
					let f = new EprFormatter(document, options);
					f.formatWholeDocument();
					return f.getEdits();
				},
				`${document.uri.fsPath} (${document.lineCount} lines)`
			);
		},
	}));

	//编译命令
	context.subscriptions.push(
		vscode.commands.registerCommand('eproto.compileCurrentFile', () => compileEpr(context))
	);
}

export function deactivate() { }
