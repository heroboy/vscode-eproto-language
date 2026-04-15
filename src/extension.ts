import * as vscode from 'vscode';
//import { EprBraceAnalyzer } from './parser';
//import { EprParser } from './EprParser';
import { EprParser2 } from './EprParser2';
import { EprFormatter } from './EprFormatter';
import { InitEprDocument } from './InitEprDocument';
import { compileEpr } from './compile';
const SETTING_KEYS = [
	'protoname',
	'protoid',
	'interfacestyle',
	'serverlanguage',
	'csharpeventstyle',
	'notWriteDate'
];

const TYPE_KEYWORDS = 'char|uchar|byte|short|ushort|int|long|uint|ulong|int64|longlong|uint64|ulonglong|string|bool|float|double|msgtype|bitbool|u8string'.split('|');

const MODIFY_KEYWORDS = 's2c|c2s|equal|var|msgfrom'.split('|');

const g_Parsers = new Map<string, EprParser2>();

function getParserForDocument(document: vscode.TextDocument): EprParser2 | undefined
{
	if (document.languageId !== 'eproto') return undefined;
	const key = document.uri.toString();
	let parser = g_Parsers.get(key);
	if (!parser)
	{
		parser = new EprParser2(document);
		g_Parsers.set(key, parser);
	}
	return parser;
}

export function activate(context: vscode.ExtensionContext)
{
	const keywordItem = (name: string) => new vscode.CompletionItem(name, vscode.CompletionItemKind.Keyword);
	const KEYWORDS_COMPLETE_ITEMS = [
		keywordItem('struct'),
		keywordItem('message'),
		...SETTING_KEYS.map(keywordItem)
	];
	const TYPE_KEYWORDS_COMPLETE_ITEMS = TYPE_KEYWORDS.map(name => new vscode.CompletionItem(name, vscode.CompletionItemKind.TypeParameter));
	const MODIFY_KEYWORDS_COMPLETE_ITEMS = MODIFY_KEYWORDS.map(name => new vscode.CompletionItem(name, vscode.CompletionItemKind.Keyword));
	/* ========= 自动完成 ========= */
	context.subscriptions.push(
		vscode.languages.registerCompletionItemProvider(
			'eproto',
			{
				provideCompletionItems(document, position)
				{
					const parser = getParserForDocument(document);
					if (!parser) return;

					const lineText = document.lineAt(position.line).text;
					const before = lineText.slice(0, position.character);

					const isLineStartLike = /^\s*[A-Za-z_]*$/.test(before);
					const inBrace = parser.isInBrace(position.line);

					/* ===== 行首 & 不在大括号内 ===== */
					if (isLineStartLike && !inBrace)
					{
						return KEYWORDS_COMPLETE_ITEMS.slice();
					}

					/* ===== 在大括号内：字段定义 ===== */
					if (inBrace && isLineStartLike)
					{
						const ret = [...TYPE_KEYWORDS_COMPLETE_ITEMS, ...parser.getTypeNamesFromLine(position.line).map(msg =>
						{
							let item = new vscode.CompletionItem(msg.name, vscode.CompletionItemKind.TypeParameter);
							let detail = msg.isMsg ? 'message' : 'struct';
							if (msg.protoId != null) detail += ':' + msg.protoId;
							return item;
						})];
						return ret;
					}

					if (!inBrace)
					{
						const messageLikeMatch = /^\s*message\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*/.exec(lineText.substring(0, position.character));
						if (messageLikeMatch)
						{
							return MODIFY_KEYWORDS_COMPLETE_ITEMS.slice();
						}
					}

					return;
				}
			}
		)
	);
	function doCompleteFieldProtoId(document: vscode.TextDocument, lineNo: number)
	{
		const line = document.lineAt(lineNo);
		if (!line) return;
		const lineText = line.text;
		// 已经有 id（:number）
		if (/:\s*\d+/.test(lineText)) return;

		// 看起来像字段定义？
		let m = /^\s*[A-Za-z_][A-Za-z0-9_]*\s+[A-Za-z_][A-Za-z0-9_]*/.exec(lineText);
		if (!m) return;

		const pp = getParserForDocument(document);
		if (!pp) return;
		if (!pp.isInBrace(lineNo)) return;
		const nextId = pp.getNextFieldId(document, lineNo);
		if (nextId == null) return;

		const edit = new vscode.WorkspaceEdit();
		const insertPos = line.range.start.translate(0, m[0].length);
		let add = `:${nextId}`;

		edit.insert(
			document.uri,
			insertPos,
			add
		);
		if (!/;\s*$/.test(lineText))
		{
			edit.insert(
				document.uri,
				line.range.end,
				';'
			);
		}
		vscode.workspace.applyEdit(edit);
	}
	/* ========= 换行自动补 ID ========= */
	context.subscriptions.push(
		vscode.workspace.onDidChangeTextDocument(e =>
		{
			if (e.document.languageId !== 'eproto') return;
			if (e.contentChanges.length !== 1) return;

			const change = e.contentChanges[0];

			// 只处理回车
			if (change.text === ';')
			{
				doCompleteFieldProtoId(e.document, change.range.start.line);
				return;
			}
			if (!change.text.includes('\n')) return;
			const pp = getParserForDocument(e.document);
			if (!pp) return;
			const inComment = pp.isInBlockComment(change.range.start.line);
			if (inComment) return;
			const inBrace = pp.isInBrace(change.range.start.line);
			if (!inBrace) 
			{
				const line = e.document.lineAt(change.range.start.line);
				const m = /^\s*message\s+([a-zA-Z_][a-zA-Z0-9_]*)/.exec(line.text);
				if (m)
				{
					const remain = line.text.substring(m.index + m[0].length);
					if (!/:\s*\d+/.test(remain))
					{
						const nextId = pp.getNextMsgId();
						const insertPos = line.range.start.translate(0, m.index + m[0].length);
						const edit = new vscode.WorkspaceEdit();
						let add = `:${nextId}`;
						if (remain && !remain.startsWith(' '))
							add += ' ';
						edit.insert(
							e.document.uri,
							insertPos,
							add
						);
						vscode.workspace.applyEdit(edit);
					}
				}

				return; // 大括号内
			}
			doCompleteFieldProtoId(e.document, change.range.start.line);
		})
	);
	const output = vscode.window.createOutputChannel('EPR Parser');

	// 打开文档
	// context.subscriptions.push(
	// 	vscode.workspace.onDidOpenTextDocument(doc =>
	// 	{
	// 		if (doc.languageId === 'eproto')
	// 		{
	// 			output.appendLine(`Opened eproto document: ${doc.uri.toString()},${doc.fileName}`);
	// 			parsers.set(doc.uri.toString(), new EprParser(doc));
	// 		}
	// 	})
	// );

	// 文档修改
	context.subscriptions.push(
		vscode.workspace.onDidChangeTextDocument(e =>
		{
			const parser = g_Parsers.get(e.document.uri.toString());
			if (parser)
			{
				parser.onDidChangeTextDocument(e);
			}
		})
	);

	// 文档关闭
	context.subscriptions.push(
		vscode.workspace.onDidCloseTextDocument(doc =>
		{
			output.appendLine(`Closed eproto document: ${doc.uri.toString()}`);
			g_Parsers.delete(doc.uri.toString());
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand(
			'eproto.dumpCurrentLineState',
			() =>
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

				const position = editor.selection.active;
				const line = position.line;

				const parser = getParserForDocument(document);
				if (!parser)
				{
					vscode.window.showErrorMessage('Parser not found');
					return;
				}

				const state = parser.getLineStatus(line);
				if (!state)
				{
					vscode.window.showErrorMessage('LineState not found');
					return;
				}

				output.clear();
				output.appendLine(`line status: ${state.toString()}`);
				output.appendLine('---');
				output.show(true);
			}
		)
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('eproto.initDocument', InitEprDocument)
	);

	context.subscriptions.push(vscode.languages.registerDocumentFormattingEditProvider('eproto', {
		provideDocumentFormattingEdits(document, options, token)
		{
			let f = new EprFormatter(document, options);
			f.formatWholeDocument();
			return f.getEdits();
		},
	}));

	context.subscriptions.push(
		vscode.commands.registerCommand('eproto.compileCurrentFile', () => compileEpr(context))
	);
}

function createKeyword(word: string)
{
	const item = new vscode.CompletionItem(word, vscode.CompletionItemKind.Keyword);
	item.insertText = word + ' ';
	return item;
}

export function deactivate() { }
