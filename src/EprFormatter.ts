import * as vscode from 'vscode';
import { EprLineLexer, EprToken, EprTokenType } from './EprLexer';

/** 缩进缓存的最大深度，超过后直接按需生成，避免病态输入把缓存撑爆 */
const MAX_CACHED_INDENT_DEPTH = 64;

/**
 * epr 文件格式化器。
 *
 * 只处理「行首缩进」与「空白行」，行内内容保持原样（与旧实现风格一致）：
 * 1. 按 `{` / `}` 的嵌套深度缩进，行首的 `}`（含 `};`）回退一级；
 * 2. 注释与字符串里的花括号不参与深度计算；
 * 3. 纯空白行清空；
 * 4. 块注释的续行保持原样（常用于手工排版或被注释掉的代码），
 *    但仍然参与深度统计之外的所有判断；
 * 5. 语法错误时尽量容错，多余的 `}` 只把深度夹到 0。
 */
export class EprFormatter
{
	private readonly document: vscode.TextDocument;
	private readonly indentUnit: string;
	private readonly edits: vscode.TextEdit[] = [];
	private readonly lexer = new EprLineLexer();
	/** 缩进字符串缓存：indentCache[n] 表示 n 层缩进 */
	private readonly indentCache: string[] = [''];
	/** 当前行之前的花括号深度 */
	private depth = 0;

	constructor(document: vscode.TextDocument, options: vscode.FormattingOptions)
	{
		this.document = document;
		this.indentUnit = options.insertSpaces ? ' '.repeat(options.tabSize) : '\t';
	}

	getEdits(): vscode.TextEdit[]
	{
		return this.edits;
	}

	formatWholeDocument()
	{
		this.edits.length = 0;
		this.depth = 0;
		this.lexer.reset();

		const lineCount = this.document.lineCount;
		for (let i = 0; i < lineCount; ++i)
		{
			this.formatLine(i);
		}
	}

	private formatLine(lineNo: number)
	{
		const line = this.document.lineAt(lineNo);
		const text = line.text;

		//必须在 scanLine 之前读取行首状态，scanLine 会推进块注释状态
		const startsInBlockComment = this.lexer.inBlockComment;
		const tokens = this.lexer.scanLine(text);

		const firstNonWhitespace = findFirstNonWhitespace(text);
		if (firstNonWhitespace >= text.length)
		{
			//块注释内部的空白行属于注释内容，保持原样
			if (!startsInBlockComment && text.length > 0)
			{
				this.edits.push(vscode.TextEdit.delete(line.range));
			}
			return;
		}

		if (!startsInBlockComment)
		{
			const indent = this.getIndentString(this.getIndentDepth(tokens));
			if (firstNonWhitespace !== indent.length || !text.startsWith(indent))
			{
				const start = line.range.start;
				this.edits.push(vscode.TextEdit.replace(
					new vscode.Range(start, start.translate(0, firstNonWhitespace)),
					indent
				));
			}
		}

		this.updateDepth(tokens);
	}

	/**
	 * 计算本行应该使用的缩进层数。
	 * 行首连续的 `}` 需要回退，注释 token 不打断这个判断。
	 */
	private getIndentDepth(tokens: readonly EprToken[]): number
	{
		let leadingCloses = 0;
		for (const token of tokens)
		{
			if (token.type === EprTokenType.Comment)
				continue;

			if (token.type === EprTokenType.Punctuation && token.text === '}')
			{
				leadingCloses++;
				continue;
			}

			break;
		}

		const depth = this.depth - leadingCloses;
		return depth > 0 ? depth : 0;
	}

	/** 根据本行的 `{` / `}` 更新扫描深度 */
	private updateDepth(tokens: readonly EprToken[])
	{
		let depth = this.depth;
		for (const token of tokens)
		{
			if (token.type !== EprTokenType.Punctuation)
				continue;

			if (token.text === '{')
				depth++;
			else if (token.text === '}')
				depth--;
		}
		this.depth = depth > 0 ? depth : 0;
	}

	private getIndentString(depth: number): string
	{
		if (depth <= 0)
			return '';

		const cache = this.indentCache;
		if (depth > MAX_CACHED_INDENT_DEPTH)
			return this.indentUnit.repeat(depth);

		while (cache.length <= depth)
		{
			cache.push(cache[cache.length - 1] + this.indentUnit);
		}
		return cache[depth];
	}
}

/** 返回第一个非空格/Tab 字符的下标；整行都是空白时返回 text.length */
function findFirstNonWhitespace(text: string): number
{
	const len = text.length;
	for (let i = 0; i < len; i++)
	{
		const code = text.charCodeAt(i);
		if (code !== 0x20 && code !== 0x09)
			return i;
	}
	return len;
}
