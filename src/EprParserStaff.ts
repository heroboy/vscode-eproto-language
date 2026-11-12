import * as vscode from 'vscode';
import { EprLineLexer, EprToken, EprTokenType } from './EprLexer';
import {
	EprDeclInfo,
	EprDeclKind,
	EprLineInfo,
	EprLineMode,
	EprParser,
	MAX_TAG,
	isDeclKeyword,
	parseFieldHeader,
} from './EprParser';

/* ========================================================================== */
/* 常量表                                                                      */
/* ========================================================================== */

const BUILTIN_TYPES = [
	'char', 'uchar', 'byte', 'short', 'ushort',
	'int', 'long', 'uint', 'ulong',
	'int64', 'longlong', 'uint64', 'ulonglong',
	'float', 'double', 'bool', 'bitbool',
	'string', 'u8string', 'msgtype',
];

const STRUCT_MODIFIERS = ['var', 'noprotect', 'opt', 'deprecated', 'extends', 'public', 'ts'];
const MESSAGE_MODIFIERS = [
	'c2s', 's2c', 'equal', 'var', 'noprotect', 'opt', 'deprecated',
	'norecvfun', 'hook', 'msgfrom', 'extends', 'public', 'responses', 'asyncresponses', 'ts',
];
const ENUM_MODIFIERS = ['class', 'itemsafe'];
const ENUM_BASE_TYPES = ['char', 'uchar', 'byte', 'short', 'ushort', 'int', 'uint', 'long', 'ulong'];
const USERCLASS_ATTRIBUTES = ['extends', 'public', 'cppinclude', 'csharpnamespace', 'as3pack'];
const FIELD_MODIFIERS = ['deprecated', 'opt'];
const BOOL_VALUES = ['true', 'false'];
const BOOLEAN_DIRECTIVE_VALUES = ['0', '1'];

interface DirectiveSpec
{
	readonly name: string;
	readonly detail: string;
	readonly values?: readonly string[];
}

const DIRECTIVES: readonly DirectiveSpec[] = [
	{ name: 'protoname', detail: '协议名，决定生成文件基名与包名（必填）' },
	{ name: 'protoid', detail: '协议号，0 <= id < 65500' },
	{ name: 'interfacestyle', detail: 'C/S 接口生成风格', values: ['stdcsgame', 'stdcs', 'equal', 'nointerface'] },
	{ name: 'namespace', detail: 'C++ 命名空间' },
	{ name: 'tsnamespace', detail: 'TypeScript 命名空间（点分字符串）' },
	{ name: 'tsModuleStyle', detail: 'TypeScript 模块引用风格', values: ['module', 'moduleV3'] },
	{ name: 'notWriteDate', detail: '生成文件头不写时间戳', values: BOOLEAN_DIRECTIVE_VALUES },
	{ name: 'cppPrecompileHeader', detail: 'C++ 预编译头文件名' },
	{ name: 'cppWithNSName', detail: 'C++ 接口签名是否带命名空间前缀', values: BOOLEAN_DIRECTIVE_VALUES },
	{ name: 'cppToJsonStyle', detail: 'C++ JSON 输出风格', values: ['min', 'pretty'] },
	{ name: 'cppWriteProtoTools', detail: '是否生成协议工具类', values: BOOLEAN_DIRECTIVE_VALUES },
	{ name: 'interfaceWithTableID', detail: 'TS 回调是否额外带 tableID', values: BOOLEAN_DIRECTIVE_VALUES },
	{ name: 'notostream', detail: 'TS 不生成 toStream', values: BOOLEAN_DIRECTIVE_VALUES },
	{ name: 'protousefor', detail: 'TS 裁剪策略', values: ['default', 'configs'] },
	{ name: 'serverlanguage', detail: '历史指令：服务端语言', values: ['cpp', 'as3', 'csharp'] },
	{ name: 'csharpeventstyle', detail: '历史指令', values: ['default', 'gaowei'] },
	{ name: 'as3mainpackage', detail: '历史指令：AS3 主包名' },
	{ name: 'as3toolpackage', detail: '历史指令：AS3 工具包名' },
	{ name: 'cppmultifile', detail: '已废弃，无效果', values: BOOLEAN_DIRECTIVE_VALUES },
	{ name: 'cppCodeStyle', detail: '已废弃，无效果' },
];

const DIRECTIVE_BY_NAME = new Map(DIRECTIVES.map(spec => [spec.name.toLowerCase(), spec]));

/* ========================================================================== */
/* 解析结果缓存                                                                */
/* ========================================================================== */

interface CachedParser
{
	readonly version: number;
	readonly parser: EprParser;
}

const g_Parsers = new Map<string, CachedParser>();

/**
 * 取得当前文档的解析结果。按 document.version 缓存：
 * 一次输入最多触发一次重解析，补全提供者与自动补 tag 共用同一份结果。
 */
export function getParserForDocument(document: vscode.TextDocument): EprParser
{
	const key = document.uri.toString();
	const cached = g_Parsers.get(key);
	if (cached && cached.version === document.version)
		return cached.parser;

	const parser = new EprParser(document);
	g_Parsers.set(key, { version: document.version, parser });
	return parser;
}

/* ========================================================================== */
/* 补全                                                                        */
/* ========================================================================== */

function makeItem(
	label: string,
	kind: vscode.CompletionItemKind,
	detail?: string,
	insertText?: string,
	sortText?: string
): vscode.CompletionItem
{
	const item = new vscode.CompletionItem(label, kind);
	if (detail)
		item.detail = detail;
	if (insertText !== undefined)
		item.insertText = insertText;
	if (sortText)
		item.sortText = sortText;
	return item;
}

function isPunct(token: EprToken | undefined, text: string): boolean
{
	return !!token && token.type === EprTokenType.Punctuation && token.text === text;
}

function declKindToCompletionKind(kind: EprDeclKind): vscode.CompletionItemKind
{
	switch (kind)
	{
		case EprDeclKind.Enum: return vscode.CompletionItemKind.Enum;
		case EprDeclKind.UserClass: return vscode.CompletionItemKind.Class;
		default: return vscode.CompletionItemKind.Struct;
	}
}

function typeItems(parser: EprParser, line: number): vscode.CompletionItem[]
{
	const items: vscode.CompletionItem[] = [];
	const seen = new Set<string>();

	for (const name of BUILTIN_TYPES)
	{
		seen.add(name);
		items.push(makeItem(name, vscode.CompletionItemKind.TypeParameter, '内建类型'));
	}

	for (const decl of parser.getTypeDeclarationsBefore(line))
	{
		if (!decl.name || seen.has(decl.name))
			continue;
		seen.add(decl.name);
		const detail = decl.tag !== null ? `${decl.kind}:${decl.tag}` : decl.kind;
		items.push(makeItem(decl.name, declKindToCompletionKind(decl.kind), detail));
	}

	return items;
}

function userTypeItems(parser: EprParser, line: number, kinds: readonly EprDeclKind[]): vscode.CompletionItem[]
{
	const items: vscode.CompletionItem[] = [];
	for (const decl of parser.getTypeDeclarationsBefore(line))
	{
		if (!decl.name || !kinds.includes(decl.kind))
			continue;
		const detail = decl.tag !== null ? `${decl.kind}:${decl.tag}` : decl.kind;
		items.push(makeItem(decl.name, declKindToCompletionKind(decl.kind), detail));
	}
	return items;
}

function tagItem(tag: number, detail: string): vscode.CompletionItem
{
	return makeItem(String(tag), vscode.CompletionItemKind.Value, detail, undefined, '0');
}

function directiveValueItems(spec: DirectiveSpec): vscode.CompletionItem[]
{
	if (!spec.values)
		return [];
	return spec.values.map(value =>
		makeItem(value, vscode.CompletionItemKind.Value, `${spec.name} 的取值`));
}

function topLevelItems(parser: EprParser): vscode.CompletionItem[]
{
	const items: vscode.CompletionItem[] = [
		makeItem('struct', vscode.CompletionItemKind.Keyword, '结构体定义', undefined, '0'),
		makeItem('message', vscode.CompletionItemKind.Keyword, '消息定义', undefined, '0'),
		makeItem('enum', vscode.CompletionItemKind.Keyword, '枚举定义', undefined, '0'),
		makeItem('userclass', vscode.CompletionItemKind.Keyword, '用户类定义', undefined, '0'),
		makeItem('import', vscode.CompletionItemKind.Keyword, '导入其它协议', 'import ', '0'),
	];

	const existing = parser.getDirectiveNames();
	for (const spec of DIRECTIVES)
	{
		if (existing.has(spec.name))
			continue;
		items.push(makeItem(
			spec.name,
			vscode.CompletionItemKind.Keyword,
			spec.detail,
			`${spec.name} = `,
			'1'
		));
	}

	return items;
}

function fieldModifierItems(): vscode.CompletionItem[]
{
	return FIELD_MODIFIERS.map(name =>
		makeItem(name, vscode.CompletionItemKind.Keyword, '字段修饰符'));
}

/** 位于某个 struct / message 的字段行时的补全。 */
function fieldCompletion(
	parser: EprParser,
	info: EprLineInfo,
	line: number,
	before: readonly EprToken[],
	depthAtCursor: number
): vscode.CompletionItem[] | undefined
{
	const decl = info.decl;
	if (!decl)
		return undefined;

	// 数组默认值内部不提示字段相关内容
	if (info.depth > decl.bodyDepth || depthAtCursor > decl.bodyDepth)
		return undefined;

	const last = before[before.length - 1];
	if (isPunct(last, ':'))
	{
		const tag = parser.getNextFieldTag(decl);
		return tag <= MAX_TAG ? [tagItem(tag, '下一个可用字段号')] : undefined;
	}

	if (isPunct(last, ';') || isPunct(last, '}'))
		return undefined;

	const identifiers = before.filter(token =>
		token.type === EprTokenType.Identifier && token.text !== 'card');

	// 类型位置：还没有类型，或刚输入 card
	if (identifiers.length === 0)
	{
		const items: vscode.CompletionItem[] = [
			makeItem('card', vscode.CompletionItemKind.Keyword, '字段修饰（历史）', undefined, '0'),
		];
		return items.concat(typeItems(parser, line));
	}

	const typeName = identifiers[0].text;
	const hasEqual = before.some(token => isPunct(token, '='));

	if (hasEqual)
	{
		if (isPunct(last, '='))
		{
			if (typeName === 'bool')
			{
				return BOOL_VALUES.map(value =>
					makeItem(value, vscode.CompletionItemKind.Value, 'bool 默认值'));
			}

			const enumDecl = findEnumBefore(parser, typeName, line);
			if (enumDecl)
			{
				return enumDecl.enumItems.map(item =>
					makeItem(item.name, vscode.CompletionItemKind.EnumMember, `${typeName} 的枚举项`));
			}
			return undefined;
		}

		return fieldModifierItems();
	}

	// 正在输入字段名时不再提示类型
	return undefined;
}

function findEnumBefore(parser: EprParser, name: string, line: number): EprDeclInfo | undefined
{
	for (const decl of parser.getTypeDeclarationsBefore(line))
	{
		if (decl.kind === EprDeclKind.Enum && decl.name === name)
			return decl;
	}
	return undefined;
}

/** 位于 struct / message / enum / userclass 头部时的补全。 */
function headerCompletion(
	parser: EprParser,
	kind: string,
	line: number,
	before: readonly EprToken[],
	depthAtCursor: number
): vscode.CompletionItem[] | undefined
{
	// 已经进入结构体内部（同一行写了 {）
	if (depthAtCursor > 0)
		return undefined;

	const last = before[before.length - 1];

	if (kind === 'enum')
	{
		if (isPunct(last, ':'))
		{
			return ENUM_BASE_TYPES.map(name =>
				makeItem(name, vscode.CompletionItemKind.TypeParameter, '枚举底层类型'));
		}
		return ENUM_MODIFIERS.map(name =>
			makeItem(name, vscode.CompletionItemKind.Keyword, '枚举修饰符'));
	}

	if (kind === 'userclass')
	{
		if (last && (last.text === 'extends' || last.text === 'public'))
			return userTypeItems(parser, line, [EprDeclKind.Struct, EprDeclKind.Message]);
		return USERCLASS_ATTRIBUTES.map(name =>
			makeItem(name, vscode.CompletionItemKind.Keyword, 'userclass 属性'));
	}

	if (isPunct(last, ':'))
	{
		const tag = parser.getNextStructureTag();
		return tag <= MAX_TAG ? [tagItem(tag, '下一个可用结构 tag')] : undefined;
	}

	if (last && (last.text === 'extends' || last.text === 'public'))
		return userTypeItems(parser, line, [EprDeclKind.Struct, EprDeclKind.Message]);

	if (last && (last.text === 'responses' || last.text === 'asyncresponses'))
		return userTypeItems(parser, line, [EprDeclKind.Message]);

	if (isPunct(last, ',') && before.some(token =>
		token.text === 'responses' || token.text === 'asyncresponses'))
	{
		return userTypeItems(parser, line, [EprDeclKind.Message]);
	}

	const modifiers = kind === 'message' ? MESSAGE_MODIFIERS : STRUCT_MODIFIERS;
	const used = new Set(before.map(token => token.text));
	return modifiers
		.filter(name => !used.has(name))
		.map(name => makeItem(name, vscode.CompletionItemKind.Keyword, `${kind} 修饰符`));
}

/**
 * 补全入口。所有上下文都由 EprParser 的行状态 + 当前行 token 判断，
 * 不依赖固定列号，因此对缩进、注释、语法错误都比较宽容。
 */
export function provideCompletionItems(
	document: vscode.TextDocument,
	position: vscode.Position
): vscode.CompletionItem[] | undefined
{
	if (document.languageId !== 'eproto')
		return undefined;

	const parser = getParserForDocument(document);
	const info = parser.getLineInfo(position.line);
	const lineText = document.lineAt(position.line).text;

	const lexer = new EprLineLexer();
	lexer.state.inBlockComment = info.inBlockComment;
	const tokens = lexer.scanLine(lineText);

	const beforeText = lineText.substring(0, position.character);
	const before: EprToken[] = [];
	let depthAtCursor = info.depth;

	for (const token of tokens)
	{
		if (token.start >= position.character)
			break;

		if (token.type === EprTokenType.Comment)
		{
			// 行注释之后的任何位置都不提示；块注释内部也不提示
			if (token.text.startsWith('//'))
				return undefined;
			if (position.character <= token.end)
				return undefined;
			continue;
		}

		if (token.type === EprTokenType.String && position.character <= token.end)
			return undefined;

		if (token.end > position.character)
			break;

		before.push(token);
		if (token.type === EprTokenType.Punctuation)
		{
			if (token.text === '{')
				depthAtCursor++;
			else if (token.text === '}')
				depthAtCursor = Math.max(0, depthAtCursor - 1);
		}
	}

	const firstCode = tokens.find(token => token.type !== EprTokenType.Comment);
	const lineStartsWithDecl = !!firstCode
		&& info.mode === EprLineMode.Top
		&& firstCode.start < position.character
		&& isDeclKeyword(firstCode.text);

	const headerKind = info.headerKind
		?? (lineStartsWithDecl ? firstCode!.text : null);

	// 结构体 / 枚举内部
	const decl = info.decl;
	if (decl && depthAtCursor >= decl.bodyDepth)
	{
		if (decl.kind === EprDeclKind.Enum)
			return undefined;
		return fieldCompletion(parser, info, position.line, before, depthAtCursor);
	}

	// 定义头（含跨行头部、同行写了 { 的情况）
	if (headerKind)
	{
		return headerCompletion(parser, headerKind, position.line, before, depthAtCursor);
	}

	// 顶层
	if (info.mode !== EprLineMode.Top || depthAtCursor !== 0)
		return undefined;

	if (before.length > 0 && before[0].type === EprTokenType.Identifier)
	{
		const spec = DIRECTIVE_BY_NAME.get(before[0].text.toLowerCase());
		if (spec && before.some(token => isPunct(token, '=')))
			return directiveValueItems(spec);
	}

	const onlyPartialWord = before.length === 1
		&& before[0].type === EprTokenType.Identifier
		&& before[0].end === position.character
		&& !beforeText.endsWith(' ');

	if (before.length === 0 || onlyPartialWord)
		return topLevelItems(parser);

	return undefined;
}

/* ========================================================================== */
/* 自动补 tag                                                                  */
/* ========================================================================== */

export interface TagInsertion
{
	readonly line: number;
	readonly character: number;
	readonly text: string;
}

function lexLine(document: vscode.TextDocument, info: EprLineInfo, line: number): readonly EprToken[]
{
	const lexer = new EprLineLexer();
	lexer.state.inBlockComment = info.inBlockComment;
	return lexer.scanLine(document.lineAt(line).text);
}

/**
 * 字段行缺少 tag 时，返回应插入的 `:编号`。
 * 只处理 struct / message 的直接字段行（数组默认值内部不处理）。
 */
export function computeFieldTagInsertion(
	document: vscode.TextDocument,
	parser: EprParser,
	line: number
): TagInsertion | null
{
	const info = parser.getLineInfo(line);
	const decl = info.decl;
	if (!decl)
		return null;
	if (decl.kind !== EprDeclKind.Struct && decl.kind !== EprDeclKind.Message)
		return null;
	if (decl.bodyDepth <= 0 || info.depth !== decl.bodyDepth)
		return null;

	const header = parseFieldHeader(lexLine(document, info, line));
	if (!header || header.tag !== null || header.name.length === 0)
		return null;

	const tag = parser.getNextFieldTag(decl);
	if (tag > MAX_TAG)
		return null;

	return { line, character: header.nameEnd, text: `:${tag}` };
}

/**
 * struct / message 头部缺少 tag 时，返回应插入的 `:编号`。
 * `message Foo {` / `message Foo` 回车都会命中；enum / userclass 不处理。
 */
export function computeDeclarationTagInsertion(
	document: vscode.TextDocument,
	parser: EprParser,
	line: number
): TagInsertion | null
{
	const info = parser.getLineInfo(line);
	if (info.mode !== EprLineMode.Top)
		return null;

	const tokens = lexLine(document, info, line).filter(token => token.type !== EprTokenType.Comment);
	const braceIndex = tokens.findIndex(token => isPunct(token, '{'));
	const header = braceIndex >= 0 ? tokens.slice(0, braceIndex) : tokens;

	if (header.length < 2)
		return null;
	if (!isDeclKeyword(header[0].text))
		return null;

	const kind = header[0].text;
	if (kind !== 'struct' && kind !== 'message')
		return null;

	const nameToken = header[1];
	if (nameToken.type !== EprTokenType.Identifier)
		return null;

	if (header.some(token => isPunct(token, ';')))
		return null;
	if (isPunct(header[2], ':'))
		return null;

	const tag = parser.getNextStructureTag();
	if (tag > MAX_TAG)
		return null;

	return { line, character: nameToken.end, text: `:${tag}` };
}

function applyTagInsertion(document: vscode.TextDocument, insertion: TagInsertion | null)
{
	if (!insertion)
		return;

	const edit = new vscode.WorkspaceEdit();
	edit.insert(document.uri, new vscode.Position(insertion.line, insertion.character), insertion.text);
	void vscode.workspace.applyEdit(edit);
}

export function onDidChangeTextDocument(e: vscode.TextDocumentChangeEvent)
{
	if (e.document.languageId !== 'eproto')
		return;
	if (e.reason === vscode.TextDocumentChangeReason.Undo
		|| e.reason === vscode.TextDocumentChangeReason.Redo)
		return;
	if (e.contentChanges.length !== 1)
		return;

	const change = e.contentChanges[0];
	if (change.rangeLength !== 0)
		return;

	const inserted = change.text;
	//回车可能带自动缩进；`{` 可能被自动闭合为 `{}`
	const isNewline = /^\r?\n[ \t]*$/.test(inserted);
	const isOpenBrace = inserted === '{' || inserted === '{}';
	if (inserted !== ';' && !isNewline && !isOpenBrace)
		return;

	const document = e.document;
	const line = change.range.start.line;
	const character = change.range.start.character;
	const parser = getParserForDocument(document);
	const info = parser.getLineInfo(line);

	if (inserted === ';')
	{
		const token = lexLine(document, info, line).find(t => t.start === character);
		if (!isPunct(token, ';'))
			return;
		applyTagInsertion(document, computeFieldTagInsertion(document, parser, line));
		return;
	}

	if (isNewline)
	{
		// 只在行尾回车时补全；把一行拆成两半时不动
		const nextLine = line + 1 < document.lineCount ? document.lineAt(line + 1).text : '';
		if (nextLine.trim().length > 0)
			return;

		const insertion = computeFieldTagInsertion(document, parser, line)
			?? computeDeclarationTagInsertion(document, parser, line);
		applyTagInsertion(document, insertion);
		return;
	}

	const token = lexLine(document, info, line).find(t => t.start === character);
	if (!isPunct(token, '{'))
		return;
	applyTagInsertion(document, computeDeclarationTagInsertion(document, parser, line));
}

/* ========================================================================== */
/* 调试命令                                                                    */
/* ========================================================================== */

let g_Output: vscode.OutputChannel | undefined;

function getOutputChannel(): vscode.OutputChannel
{
	if (!g_Output)
		g_Output = vscode.window.createOutputChannel('EPR Parser');
	return g_Output;
}

function showDump(lines: readonly string[])
{
	const output = getOutputChannel();
	output.clear();
	for (const line of lines)
		output.appendLine(line);
	output.show(true);
}

function getActiveEprEditor(): vscode.TextEditor | undefined
{
	const editor = vscode.window.activeTextEditor;
	if (!editor)
	{
		vscode.window.showWarningMessage('No active editor');
		return undefined;
	}
	if (editor.document.languageId !== 'eproto')
	{
		vscode.window.showWarningMessage('Not an epr file');
		return undefined;
	}
	return editor;
}

function declToText(parser: EprParser, decl: EprDeclInfo): string
{
	const tag = decl.tag !== null ? `:${decl.tag}` : '';
	const base = decl.baseType ? ` (${decl.baseType})` : '';
	const range = decl.endLine >= 0
		? `line ${decl.line + 1}-${decl.endLine + 1}`
		: `line ${decl.line + 1}, unclosed`;
	const body = decl.kind === EprDeclKind.Enum
		? `items=${decl.enumItems.length}`
		: `fields=${decl.fields.length}, nextFieldTag=${parser.getNextFieldTag(decl)}`;
	const modifiers = decl.modifiers.length > 0 ? ` [${decl.modifiers.join(' ')}]` : '';
	return `${decl.kind.padEnd(9)} ${decl.name}${tag}${base}  ${range}  ${body}${modifiers}`;
}

export function dumpCurrentLineState()
{
	const editor = getActiveEprEditor();
	if (!editor)
		return;

	const document = editor.document;
	const parser = getParserForDocument(document);
	const line = editor.selection.active.line;
	const info = parser.getLineInfo(line);
	const text = document.lineAt(line).text;

	const lexer = new EprLineLexer();
	lexer.state.inBlockComment = info.inBlockComment;
	const tokens = lexer.scanLine(text);

	const lines: string[] = [
		`文件: ${document.uri.fsPath}`,
		`版本: ${document.version}  行: ${line + 1}/${document.lineCount}`,
		`深度: ${info.depth} -> ${info.endDepth}`,
		`块注释: ${info.inBlockComment ? 'in' : 'out'} -> ${info.endInBlockComment ? 'in' : 'out'}`,
		`模式: ${info.mode}  headerKind: ${info.headerKind ?? '-'}`,
		`所属定义: ${info.decl ? declToText(parser, info.decl) : '-'}`,
		`下一个结构 tag: ${parser.getNextStructureTag()}`,
		'',
		`行文本: ${JSON.stringify(text)}`,
		`tokens: ${tokens.map(token => `[${EprTokenType[token.type]}]${token.text}`).join(' ')}`,
	];

	const header = parseFieldHeader(tokens);
	if (header)
	{
		lines.push(`字段头: type=${header.typeName}, name=${header.name}, tag=${header.tag ?? '-'}, insertAt=${header.nameEnd}`);
	}

	if (info.decl)
	{
		const decl = info.decl;
		lines.push(`字段数: ${decl.fields.length}  下一个字段 tag: ${parser.getNextFieldTag(decl)}`);
		if (decl.fields.length > 0)
		{
			lines.push('字段列表:');
			for (const field of decl.fields)
				lines.push(`  ${field.typeName} ${field.name}:${field.tag ?? '-'}  (line ${field.line + 1})`);
		}
	}

	showDump(lines);
}

export function dumpAllState()
{
	const editor = getActiveEprEditor();
	if (!editor)
		return;

	const document = editor.document;
	const parser = getParserForDocument(document);

	const lines: string[] = [
		`文件: ${document.uri.fsPath}`,
		`版本: ${document.version}  行数: ${document.lineCount}`,
		'',
		`指令 (${parser.directives.length}):`,
	];

	for (const directive of parser.directives)
		lines.push(`  ${directive.rawName} = ${directive.value}  (line ${directive.line + 1})`);

	lines.push(`import (${parser.imports.length}):`);
	for (const item of parser.imports)
		lines.push(`  "${item}"`);

	lines.push('', `定义 (${parser.declarations.length}):`);
	for (const decl of parser.declarations)
		lines.push(`  ${declToText(parser, decl)}`);

	lines.push('', `下一个结构 tag: ${parser.getNextStructureTag()}`);

	lines.push('', `解析问题 (${parser.issues.length}):`);
	const showCount = Math.min(parser.issues.length, 50);
	for (let i = 0; i < showCount; i++)
	{
		const issue = parser.issues[i];
		lines.push(`  line ${issue.line + 1}: ${issue.message}`);
	}
	if (parser.issues.length > showCount)
		lines.push(`  ... 还有 ${parser.issues.length - showCount} 条`);

	showDump(lines);
}

/* ========================================================================== */
/* 激活                                                                        */
/* ========================================================================== */

export function activateEprParserStaff(context: vscode.ExtensionContext)
{
	context.subscriptions.push(getOutputChannel());

	context.subscriptions.push(
		vscode.languages.registerCompletionItemProvider('eproto', { provideCompletionItems }, ':')
	);

	context.subscriptions.push(
		vscode.workspace.onDidChangeTextDocument(onDidChangeTextDocument)
	);

	context.subscriptions.push(
		vscode.workspace.onDidCloseTextDocument(document =>
		{
			g_Parsers.delete(document.uri.toString());
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('eproto.dumpCurrentLineState', dumpCurrentLineState),
		vscode.commands.registerCommand('eproto.dumpAllState', dumpAllState)
	);
}
