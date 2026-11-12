/**
 * epr 语言的逐行词法扫描器。
 *
 * 设计目标：
 * - 只负责「把一行文本切成 token」，不涉及语法与语义，格式化器与解析器可以共用；
 * - 跨行状态（块注释）由调用方持有，可以从任意一行开始增量扫描；
 * - 单趟扫描、不回溯、不构造正则，避免大文件上的性能问题。
 *
 * 词法规则以 `EprDoc/01-词法与文件结构.md` 为准：
 * - 字符串没有转义，不能跨行，遇到下一个双引号即结束；
 * - 块注释不能嵌套，未闭合时延续到文件末尾；
 * - 行注释吞掉行尾的全部内容。
 */

export enum EprTokenType
{
	Identifier,
	Number,
	String,
	/** 行注释、块注释，以及块注释在某一行的续行片段 */
	Comment,
	/** epr 的标点：{ } [ ] : ; , = . ( ) < > */
	Punctuation,
	/** 非法字符，留给解析器报错；格式化器忽略 */
	Unknown,
}

export interface EprToken
{
	readonly type: EprTokenType;
	/** 在行内的起始列（从 0 开始） */
	readonly start: number;
	/** 在行内的结束列（不包含） */
	readonly end: number;
	/** token 原文 */
	readonly text: string;
}

/** 跨行词法状态。 */
export class EprLexerState
{
	/** 行尾是否仍处于块注释内部 */
	inBlockComment = false;

	reset()
	{
		this.inBlockComment = false;
	}
}

const CHAR_SPACE = 0x20;
const CHAR_DOUBLE_QUOTE = 0x22;
const CHAR_STAR = 0x2a;
const CHAR_MINUS = 0x2d;
const CHAR_DOT = 0x2e;
const CHAR_SLASH = 0x2f;
const CHAR_0 = 0x30;
const CHAR_9 = 0x39;
const CHAR_UPPER_A = 0x41;
const CHAR_UPPER_Z = 0x5a;
const CHAR_UNDERSCORE = 0x5f;
const CHAR_LOWER_A = 0x61;
const CHAR_LOWER_Z = 0x7a;
const CHAR_LOWER_F = 0x66;

const PUNCTUATION_CHARS = '{}[]:;,.=()<>';
const PUNCTUATION_TABLE = createPunctuationTable();

function createPunctuationTable(): boolean[]
{
	const table = new Array<boolean>(128).fill(false);
	for (let i = 0; i < PUNCTUATION_CHARS.length; i++)
	{
		table[PUNCTUATION_CHARS.charCodeAt(i)] = true;
	}
	return table;
}

/** 空格、Tab 以及其它 < 0x20 的控制字符（换行由调用方按行切分，不会出现在这里） */
function isWhitespaceCode(code: number): boolean
{
	return code === CHAR_SPACE || (code > 0 && code < CHAR_SPACE);
}

function isDigitCode(code: number): boolean
{
	return code >= CHAR_0 && code <= CHAR_9;
}

function isIdentifierStartCode(code: number): boolean
{
	return code === CHAR_UNDERSCORE
		|| (code >= CHAR_UPPER_A && code <= CHAR_UPPER_Z)
		|| (code >= CHAR_LOWER_A && code <= CHAR_LOWER_Z);
}

function isIdentifierCharCode(code: number): boolean
{
	return isIdentifierStartCode(code) || isDigitCode(code);
}

function isPunctuationCode(code: number): boolean
{
	return code >= 0 && code < PUNCTUATION_TABLE.length && PUNCTUATION_TABLE[code];
}

/** `-` 之后是否可以开始一个数字（`-7`、`-.5`） */
function isNumberStartAfterSign(text: string, pos: number): boolean
{
	const code = text.charCodeAt(pos);
	return isDigitCode(code) || (code === CHAR_DOT && isDigitCode(text.charCodeAt(pos + 1)));
}

/**
 * 扫描数字字面量：`[ '-' ] ( digit { digit } [ '.' digit { digit } [ 'f' ] ]
 *                          | '.' digit { digit } [ 'f' ] )`
 */
function scanNumberEnd(text: string, start: number): number
{
	const len = text.length;
	let pos = start;

	if (text.charCodeAt(pos) === CHAR_MINUS)
		pos++;

	if (text.charCodeAt(pos) === CHAR_DOT)
	{
		pos++;
		while (pos < len && isDigitCode(text.charCodeAt(pos)))
			pos++;
	}
	else
	{
		while (pos < len && isDigitCode(text.charCodeAt(pos)))
			pos++;
		if (text.charCodeAt(pos) === CHAR_DOT && isDigitCode(text.charCodeAt(pos + 1)))
		{
			pos++;
			while (pos < len && isDigitCode(text.charCodeAt(pos)))
				pos++;
		}
	}

	if (text.charCodeAt(pos) === CHAR_LOWER_F)
		pos++;

	return pos;
}

function createToken(type: EprTokenType, text: string, start: number, end: number): EprToken
{
	return { type, start, end, text: text.substring(start, end) };
}

/**
 * 行词法扫描器。
 *
 * 用法：
 * ```ts
 * const lexer = new EprLineLexer();
 * for (const line of lines)
 * {
 *     const tokens = lexer.scanLine(line);
 *     ...
 * }
 * ```
 */
export class EprLineLexer
{
	readonly state = new EprLexerState();
	private readonly tokenBuffer: EprToken[] = [];

	/** 上一行扫描结束时是否仍处于块注释中 */
	get inBlockComment(): boolean
	{
		return this.state.inBlockComment;
	}

	reset()
	{
		this.state.reset();
		this.tokenBuffer.length = 0;
	}

	/**
	 * 扫描一行文本（不含换行符）。
	 *
	 * 返回的数组由内部复用，下一次调用 `scanLine` 时会被清空；
	 * 需要长期保存 token 的调用方请自行复制。
	 */
	scanLine(text: string): readonly EprToken[]
	{
		const tokens = this.tokenBuffer;
		const state = this.state;
		const len = text.length;
		tokens.length = 0;

		let pos = 0;
		while (pos < len)
		{
			//块注释的续行：一直吃到 `*/` 或者行尾
			if (state.inBlockComment)
			{
				const close = text.indexOf('*/', pos);
				if (close < 0)
				{
					tokens.push(createToken(EprTokenType.Comment, text, pos, len));
					return tokens;
				}

				const end = close + 2;
				tokens.push(createToken(EprTokenType.Comment, text, pos, end));
				state.inBlockComment = false;
				pos = end;
				continue;
			}

			const code = text.charCodeAt(pos);

			if (isWhitespaceCode(code))
			{
				pos++;
				continue;
			}

			if (code === CHAR_DOUBLE_QUOTE)
			{
				//字符串没有转义，也不能跨行；未闭合时容错到行尾
				const close = text.indexOf('"', pos + 1);
				const end = close < 0 ? len : close + 1;
				tokens.push(createToken(EprTokenType.String, text, pos, end));
				pos = end;
				continue;
			}

			if (code === CHAR_SLASH)
			{
				const next = text.charCodeAt(pos + 1);
				if (next === CHAR_SLASH)
				{
					tokens.push(createToken(EprTokenType.Comment, text, pos, len));
					return tokens;
				}

				if (next === CHAR_STAR)
				{
					const close = text.indexOf('*/', pos + 2);
					if (close < 0)
					{
						tokens.push(createToken(EprTokenType.Comment, text, pos, len));
						state.inBlockComment = true;
						return tokens;
					}

					const end = close + 2;
					tokens.push(createToken(EprTokenType.Comment, text, pos, end));
					pos = end;
					continue;
				}
			}

			if (isDigitCode(code)
				|| (code === CHAR_MINUS && isNumberStartAfterSign(text, pos + 1))
				|| (code === CHAR_DOT && isDigitCode(text.charCodeAt(pos + 1))))
			{
				const end = scanNumberEnd(text, pos);
				tokens.push(createToken(EprTokenType.Number, text, pos, end));
				pos = end;
				continue;
			}

			if (isIdentifierStartCode(code))
			{
				let end = pos + 1;
				while (end < len && isIdentifierCharCode(text.charCodeAt(end)))
					end++;
				tokens.push(createToken(EprTokenType.Identifier, text, pos, end));
				pos = end;
				continue;
			}

			if (isPunctuationCode(code))
			{
				tokens.push(createToken(EprTokenType.Punctuation, text, pos, pos + 1));
				pos++;
				continue;
			}

			tokens.push(createToken(EprTokenType.Unknown, text, pos, pos + 1));
			pos++;
		}

		return tokens;
	}
}
