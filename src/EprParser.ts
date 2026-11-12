import { EprLineLexer, EprToken, EprTokenType } from './EprLexer';

/**
 * 容错的 epr 文件结构解析器。
 *
 * 与编译器的「严格解析」不同，这里的首要目标是**尽量把能认出来的东西都认出来**：
 * - 遇到无法识别的内容只记录 issue，不影响后续行的解析；
 * - 结构体漏写 `}` 时，遇到下一个 `struct` / `message` / `enum` / `userclass` 会强制收尾；
 * - 字段漏写 `;` 时，在行尾也会把字段收下；
 * - 完全没有花括号的指令、`userclass`、跨行的结构头都能解析。
 *
 * 输出给上层的都是只读结构；内部状态只用于解析过程。
 */

/** 解析器只依赖 TextDocument 的这两项能力，便于测试时使用 mock。 */
export interface EprTextDocumentLike
{
	readonly lineCount: number;
	lineAt(line: number): { readonly text: string; };
}

export enum EprDeclKind
{
	Struct = 'struct',
	Message = 'message',
	Enum = 'enum',
	UserClass = 'userclass',
}

export enum EprLineMode
{
	/** 顶层（指令、结构头、空行、无法识别的内容） */
	Top,
	/** struct / message 的结构体内部 */
	Body,
	/** enum 的内部 */
	EnumBody,
}

export interface EprFieldInfo
{
	readonly typeName: string;
	readonly name: string;
	readonly tag: number | null;
	readonly line: number;
}

export interface EprEnumItemInfo
{
	readonly name: string;
	readonly value: number | null;
	readonly line: number;
}

export interface EprDeclInfo
{
	readonly kind: EprDeclKind;
	readonly name: string;
	/** struct / message 的 tag；其它类型恒为 null */
	tag: number | null;
	/** 关键字所在行（0 起） */
	readonly line: number;
	/** 结束行；-1 表示没有结束（未闭合或没有结构体） */
	endLine: number;
	/** `{` 之后的花括号深度，通常是 1；没有结构体时为 -1 */
	bodyDepth: number;
	readonly fields: EprFieldInfo[];
	readonly enumItems: EprEnumItemInfo[];
	readonly modifiers: string[];
	/** enum 的底层类型 / userclass 的基类型 / extends 的父类型 */
	baseType: string | null;
}

export interface EprDirectiveInfo
{
	/** 小写化的指令名，用于判断「是否已经写过」 */
	readonly name: string;
	readonly rawName: string;
	readonly value: string;
	readonly line: number;
}

export interface EprIssue
{
	readonly line: number;
	readonly message: string;
}

export interface EprLineInfo
{
	readonly line: number;
	/** 行首的花括号深度 */
	readonly depth: number;
	/** 行尾的花括号深度 */
	readonly endDepth: number;
	/** 行首是否在块注释内 */
	readonly inBlockComment: boolean;
	/** 行尾是否在块注释内 */
	readonly endInBlockComment: boolean;
	/** 行首所处的解析模式 */
	readonly mode: EprLineMode;
	/** 行首所处结构体（enum 也算）的定义；不在结构体内为 null */
	readonly decl: EprDeclInfo | null;
	/** 行首正在解析的顶层定义头（跨行的结构头），例如 'message' */
	readonly headerKind: string | null;
}

/** 字段头的解析结果，用于补全与自动插入 tag。 */
export interface EprFieldHeader
{
	readonly typeName: string;
	readonly name: string;
	/** 字段名结束列（不含），tag 插在这里 */
	readonly nameEnd: number;
	readonly tag: number | null;
}

const DECL_KEYWORDS = new Set<string>(['struct', 'message', 'enum', 'userclass']);

const DECL_MODIFIERS = new Set<string>([
	'c2s', 's2c', 'equal', 'var', 'noprotect', 'opt', 'deprecated', 'norecvfun',
	'hook', 'msgfrom', 'extends', 'public', 'responses', 'asyncresponses', 'ts',
	'class', 'itemsafe',
]);

export const MAX_TAG = 250;
const MAX_BUFFER_TOKENS = 512;
const MAX_ISSUES = 200;

export function isDeclKeyword(text: string): boolean
{
	return DECL_KEYWORDS.has(text);
}

function isPunctuation(token: EprToken, text: string): boolean
{
	return token.type === EprTokenType.Punctuation && token.text === text;
}

function parseInteger(text: string): number | null
{
	const value = Number.parseInt(text, 10);
	return Number.isNaN(value) ? null : value;
}

/**
 * 从一行的 token 中解析字段头：`[card] 类型 名称 :tag`。
 * 只要求「类型 + 名称」存在，tag 可以为 null（用于自动补 tag）。
 */
export function parseFieldHeader(tokens: readonly EprToken[]): EprFieldHeader | null
{
	let index = 0;
	const len = tokens.length;

	while (index < len && tokens[index].type === EprTokenType.Comment)
		index++;

	while (index < len && tokens[index].type === EprTokenType.Identifier && tokens[index].text === 'card')
		index++;

	if (index >= len || tokens[index].type !== EprTokenType.Identifier)
		return null;

	const typeToken = tokens[index++];

	while (index < len && tokens[index].type === EprTokenType.Comment)
		index++;

	if (index >= len || tokens[index].type !== EprTokenType.Identifier)
		return null;

	const nameToken = tokens[index++];
	let tag: number | null = null;

	for (; index < len; index++)
	{
		const token = tokens[index];
		if (token.type === EprTokenType.Comment)
			continue;

		if (isPunctuation(token, ':'))
		{
			const next = tokens[index + 1];
			if (next && next.type === EprTokenType.Number)
				tag = parseInteger(next.text);
			break;
		}

		// tag 必须在数组下标、默认值、语句结束之前
		if (token.type === EprTokenType.Punctuation
			&& (token.text === '[' || token.text === '=' || token.text === ';'))
			break;

		if (token.type === EprTokenType.Identifier)
			break;
	}

	return { typeName: typeToken.text, name: nameToken.text, nameEnd: nameToken.end, tag };
}

/** 一个 epr 文档的解析结果。 */
export class EprParser
{
	readonly declarations: EprDeclInfo[] = [];
	readonly directives: EprDirectiveInfo[] = [];
	readonly imports: string[] = [];
	readonly issues: EprIssue[] = [];
	readonly lines: EprLineInfo[] = [];

	private readonly document: EprTextDocumentLike;
	private readonly lexer = new EprLineLexer();
	private depth = 0;
	private mode: EprLineMode = EprLineMode.Top;
	private openDecl: EprDeclInfo | null = null;
	private buffer: EprToken[] = [];
	private bufferStartLine = -1;
	private directiveNameCache: Set<string> | null = null;

	constructor(document: EprTextDocumentLike)
	{
		this.document = document;
		this.parse();
	}

	getLineInfo(line: number): EprLineInfo
	{
		return this.lines[line] ?? {
			line,
			depth: 0,
			endDepth: 0,
			inBlockComment: false,
			endInBlockComment: false,
			mode: EprLineMode.Top,
			decl: null,
			headerKind: null,
		};
	}

	/** 文件中已经出现过的指令名（小写），用于「每个指令只提示一次」。 */
	getDirectiveNames(): ReadonlySet<string>
	{
		if (!this.directiveNameCache)
			this.directiveNameCache = new Set(this.directives.map(d => d.name));
		return this.directiveNameCache;
	}

	/** 某个定义的下一个可用字段 tag（max + 1，从 1 开始）。 */
	getNextFieldTag(decl: EprDeclInfo): number
	{
		let max = 0;
		for (const field of decl.fields)
		{
			if (field.tag !== null && field.tag > max)
				max = field.tag;
		}
		return max + 1;
	}

	/** 全文件下一个可用的结构 tag（struct / message 的 tag 全局唯一）。 */
	getNextStructureTag(): number
	{
		let max = 0;
		for (const decl of this.declarations)
		{
			if (decl.tag !== null && decl.tag > max)
				max = decl.tag;
		}
		return max + 1;
	}

	/** 当前位置之前已经声明过的类型（遵守「先声明后使用」）。 */
	getTypeDeclarationsBefore(line: number): readonly EprDeclInfo[]
	{
		return this.declarations.filter(decl => decl.line < line);
	}

	findEnum(name: string): EprDeclInfo | undefined
	{
		for (const decl of this.declarations)
		{
			if (decl.kind === EprDeclKind.Enum && decl.name === name)
				return decl;
		}
		return undefined;
	}

	private parse()
	{
		const lineCount = this.document.lineCount;
		for (let i = 0; i < lineCount; i++)
		{
			const text = this.document.lineAt(i).text;
			const startDepth = this.depth;
			const startInBlockComment = this.lexer.inBlockComment;
			const startMode = this.mode;
			const startDecl = this.openDecl;
			const startHeaderKind = this.getHeaderKind();

			const tokens = this.lexer.scanLine(text);
			this.processLine(tokens, i);

			this.lines.push({
				line: i,
				depth: startDepth,
				endDepth: this.depth,
				inBlockComment: startInBlockComment,
				endInBlockComment: this.lexer.inBlockComment,
				mode: startMode,
				decl: startDecl,
				headerKind: startHeaderKind,
			});
		}

		this.finishAtEof();
	}

	private getHeaderKind(): string | null
	{
		if (this.mode !== EprLineMode.Top || this.buffer.length === 0)
			return null;
		const first = this.buffer[0];
		return isDeclKeyword(first.text) ? first.text : null;
	}

	private processLine(tokens: readonly EprToken[], lineNo: number)
	{
		let firstCodeToken = true;
		for (const token of tokens)
		{
			if (token.type === EprTokenType.Comment)
				continue;

			if (firstCodeToken)
			{
				firstCodeToken = false;
				this.onLineFirstToken(token, tokens, lineNo);
			}

			this.checkToken(token, lineNo);
			this.handleToken(token, lineNo);
		}
		this.onLineEnd(lineNo);
	}

	private checkToken(token: EprToken, lineNo: number)
	{
		if (token.type === EprTokenType.Unknown)
		{
			this.addIssue(lineNo, `非法字符 '${token.text}'`);
			return;
		}

		if (token.type === EprTokenType.String
			&& (token.text.length < 2 || !token.text.endsWith('"')))
		{
			this.addIssue(lineNo, '字符串未闭合');
		}
	}

	/**
	 * 结构体内部的一行如果以 struct/message/... 开头，且看起来像定义而不是字段，
	 * 说明上一个结构体多半漏了 `}`；强制收尾后继续按顶层解析。
	 */
	private onLineFirstToken(token: EprToken, tokens: readonly EprToken[], lineNo: number)
	{
		if (this.mode === EprLineMode.Top)
			return;

		if (this.buffer.length > 0 || !isDeclKeyword(token.text))
			return;

		if (!this.looksLikeDeclarationLine(tokens))
			return;

		this.addIssue(lineNo, `上一层定义缺少 '}'，在此继续解析新的 ${token.text}`);
		this.closeDecl(lineNo - 1);
	}

	private looksLikeDeclarationLine(tokens: readonly EprToken[]): boolean
	{
		let hasBrace = false;
		let hasSemicolon = false;
		for (const token of tokens)
		{
			if (token.type !== EprTokenType.Punctuation)
				continue;
			if (token.text === '{')
				hasBrace = true;
			else if (token.text === ';')
				hasSemicolon = true;
		}

		// userclass 一定以 ; 结束，没有 {
		for (const token of tokens)
		{
			if (token.type === EprTokenType.Identifier)
				return token.text === 'userclass' || hasBrace || !hasSemicolon;
		}
		return false;
	}

	private handleToken(token: EprToken, lineNo: number)
	{
		switch (this.mode)
		{
			case EprLineMode.Top:
				this.handleTopToken(token, lineNo);
				break;
			case EprLineMode.Body:
				this.handleBodyToken(token, lineNo);
				break;
			case EprLineMode.EnumBody:
				this.handleEnumToken(token, lineNo);
				break;
		}
	}

	private handleTopToken(token: EprToken, lineNo: number)
	{
		if (token.type === EprTokenType.Punctuation)
		{
			if (token.text === '{')
			{
				const decl = this.buffer.length > 0
					? this.createDecl(this.buffer, this.bufferStartLine)
					: null;
				this.buffer.length = 0;

				if (decl)
				{
					decl.bodyDepth = 1;
					this.declarations.push(decl);
					this.openDecl = decl;
					this.mode = decl.kind === EprDeclKind.Enum ? EprLineMode.EnumBody : EprLineMode.Body;
					this.depth = 1;
				}
				else
				{
					// 无法识别的块：只数花括号，忽略内容
					this.depth++;
				}
				return;
			}

			if (token.text === '}')
			{
				if (this.depth > 0)
					this.depth--;
				return;
			}

			if (this.depth > 0)
				return;

			if (token.text === ';')
			{
				this.flushTopStatement(lineNo);
				return;
			}
		}

		if (this.depth > 0)
			return;

		this.pushBuffer(token, lineNo);
	}

	private handleBodyToken(token: EprToken, lineNo: number)
	{
		if (token.type === EprTokenType.Punctuation)
		{
			if (token.text === '{')
			{
				if (this.depth === 1)
					this.flushField();
				this.depth++;
				return;
			}

			if (token.text === '}')
			{
				if (this.depth > 1)
				{
					this.depth--;
					return;
				}
				this.flushField();
				this.closeDecl(lineNo);
				return;
			}

			if (this.depth > 1)
				return;

			if (token.text === ';')
			{
				this.flushField();
				return;
			}
		}

		if (this.depth > 1)
			return;

		this.pushBuffer(token, lineNo);
	}

	private handleEnumToken(token: EprToken, lineNo: number)
	{
		if (token.type === EprTokenType.Punctuation)
		{
			if (token.text === '{')
			{
				this.depth++;
				return;
			}

			if (token.text === '}')
			{
				if (this.depth > 1)
				{
					this.depth--;
					return;
				}
				this.flushEnumItem();
				this.closeDecl(lineNo);
				return;
			}

			if (this.depth > 1)
				return;

			if (token.text === ',' || token.text === ';')
			{
				this.flushEnumItem();
				return;
			}
		}

		if (this.depth > 1)
			return;

		this.pushBuffer(token, lineNo);
	}

	private pushBuffer(token: EprToken, lineNo: number)
	{
		if (this.buffer.length === 0)
			this.bufferStartLine = lineNo;
		if (this.buffer.length < MAX_BUFFER_TOKENS)
			this.buffer.push(token);
	}

	private onLineEnd(lineNo: number)
	{
		if (this.mode === EprLineMode.Body || this.mode === EprLineMode.EnumBody)
		{
			// 字段 / 枚举项漏写 ; 时也收下；数组默认值内部则继续等待
			if (this.buffer.length > 0 && this.depth <= 1)
			{
				if (this.mode === EprLineMode.Body)
					this.flushField();
				else
					this.flushEnumItem();
			}
			return;
		}

		if (this.mode !== EprLineMode.Top || this.buffer.length === 0)
			return;

		const first = this.buffer[0];
		if (!isDeclKeyword(first.text))
		{
			// 指令 / import / 垃圾内容都是单行语句，行尾直接收尾，避免吞掉后面的定义
			this.flushTopStatement(lineNo);
		}
		else if (this.buffer.length >= MAX_BUFFER_TOKENS)
		{
			this.addIssue(this.bufferStartLine, `${first.text} 定义头过长，已忽略`);
			this.buffer.length = 0;
		}
	}

	private closeDecl(lineNo: number)
	{
		if (this.openDecl)
		{
			this.openDecl.endLine = Math.max(this.openDecl.line, lineNo);
			this.openDecl = null;
		}
		this.mode = EprLineMode.Top;
		this.depth = 0;
		this.buffer.length = 0;
	}

	private flushField()
	{
		if (this.buffer.length === 0)
			return;

		const decl = this.openDecl;
		if (decl)
		{
			const header = parseFieldHeader(this.buffer);
			if (header)
			{
				decl.fields.push({
					typeName: header.typeName,
					name: header.name,
					tag: header.tag,
					line: this.bufferStartLine,
				});
			}
		}
		this.buffer.length = 0;
	}

	private flushEnumItem()
	{
		if (this.buffer.length === 0)
			return;

		const decl = this.openDecl;
		if (decl)
		{
			let name: string | null = null;
			let value: number | null = null;

			for (let i = 0; i < this.buffer.length; i++)
			{
				const token = this.buffer[i];
				if (token.type === EprTokenType.Identifier)
				{
					name = token.text;
					break;
				}
			}

			for (let i = 0; i < this.buffer.length - 1; i++)
			{
				if (isPunctuation(this.buffer[i], '='))
				{
					const next = this.buffer[i + 1];
					if (next.type === EprTokenType.Number)
						value = parseInteger(next.text);
					break;
				}
			}

			if (name !== null)
			{
				decl.enumItems.push({ name, value, line: this.bufferStartLine });
			}
		}

		this.buffer.length = 0;
	}

	private flushTopStatement(lineNo: number)
	{
		if (this.buffer.length === 0)
			return;

		//注意：buffer 是复用数组，必须复制后再清空，否则下面的 tokens[0] 会变成 undefined
		const tokens = this.buffer.slice();
		const startLine = this.bufferStartLine >= 0 ? this.bufferStartLine : lineNo;
		this.buffer.length = 0;

		const first = tokens[0];
		if (!first)
			return;

		if (isDeclKeyword(first.text))
		{
			const decl = this.createDecl(tokens, startLine);
			if (decl)
			{
				decl.endLine = lineNo;
				decl.bodyDepth = -1;
				this.declarations.push(decl);
			}
			else
			{
				this.addIssue(startLine, `无法解析的 ${first.text} 定义`);
			}
			return;
		}

		if (first.text === 'import')
		{
			const str = tokens.find(token => token.type === EprTokenType.String);
			if (str)
			{
				const value = str.text.substring(1, str.text.endsWith('"') ? str.text.length - 1 : str.text.length);
				this.imports.push(value);
			}
			else
			{
				this.addIssue(startLine, 'import 缺少字符串参数');
			}
			return;
		}

		if (first.type === EprTokenType.Identifier)
		{
			this.directives.push({
				name: first.text.toLowerCase(),
				rawName: first.text,
				value: readDirectiveValue(tokens),
				line: startLine,
			});
			return;
		}

		this.addIssue(startLine, `无法识别的顶层内容 '${first.text}'`);
	}

	private createDecl(tokens: readonly EprToken[], line: number): EprDeclInfo | null
	{
		const first = tokens[0];
		if (!isDeclKeyword(first.text))
			return null;

		const kind = first.text as EprDeclKind;
		let index = 1;
		const modifiers: string[] = [];

		if (kind === EprDeclKind.Enum && tokens[index]?.text === 'class')
		{
			modifiers.push('class');
			index++;
		}

		while (index < tokens.length && tokens[index].type !== EprTokenType.Identifier)
			index++;

		if (index >= tokens.length)
			return null;

		const name = tokens[index].text;
		index++;

		const decl: EprDeclInfo = {
			kind,
			name,
			tag: null,
			line,
			endLine: -1,
			bodyDepth: -1,
			fields: [],
			enumItems: [],
			modifiers,
			baseType: null,
		};

		for (; index < tokens.length; index++)
		{
			const token = tokens[index];
			if (token.type === EprTokenType.Comment)
				continue;

			if (isPunctuation(token, ':'))
			{
				const next = tokens[index + 1];
				if (!next)
					continue;

				if (kind === EprDeclKind.Enum)
					decl.baseType = next.text;
				else if (next.type === EprTokenType.Number)
					decl.tag = parseInteger(next.text);

				index++;
				continue;
			}

			if (token.type !== EprTokenType.Identifier)
				continue;

			if (token.text === 'extends' || token.text === 'public')
			{
				if (!modifiers.includes(token.text))
					modifiers.push(token.text);

				const next = tokens[index + 1];
				if (next && next.type === EprTokenType.Identifier)
				{
					decl.baseType = next.text;
					index++;
				}
				continue;
			}

			if (DECL_MODIFIERS.has(token.text) && !modifiers.includes(token.text))
				modifiers.push(token.text);
		}

		return decl;
	}

	private finishAtEof()
	{
		//文件在结构头/指令中间结束时，尽量把最后一条语句也收下
		if (this.mode === EprLineMode.Top && this.buffer.length > 0)
			this.flushTopStatement(this.lines.length);

		if (this.openDecl)
		{
			this.addIssue(this.openDecl.line, `${this.openDecl.kind} ${this.openDecl.name} 缺少 '}'`);
			this.openDecl.endLine = -1;
			this.openDecl = null;
		}

		if (this.depth > 0)
			this.addIssue(this.lines.length, `文件结束时还有 ${this.depth} 个未闭合的 '{'`);

		if (this.lexer.inBlockComment)
			this.addIssue(this.lines.length, '块注释未闭合');
	}

	private addIssue(line: number, message: string)
	{
		if (this.issues.length >= MAX_ISSUES)
			return;
		this.issues.push({ line: Math.max(0, line), message });
	}
}

/** 某个指令的取值（去掉前导 `=`）。 */
function readDirectiveValue(tokens: readonly EprToken[]): string
{
	let index = 1;
	if (index < tokens.length && isPunctuation(tokens[index], '='))
		index++;

	const parts: string[] = [];
	for (; index < tokens.length; index++)
	{
		const token = tokens[index];
		if (token.type === EprTokenType.Comment)
			continue;
		parts.push(token.text);
	}
	return parts.join(' ');
}
