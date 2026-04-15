import { TextEdit, Range } from "vscode";
import * as vscode from 'vscode';
import { isPunc, isSymbolChar, isWhiteSpace } from "./CharUtil";

enum PositionStatus
{
	Empty = 0,
	InBrace = 1 << 0,
	InBlockComment = 1 << 1,
}

export class EprFormatter
{
	private document: vscode.TextDocument;
	private indentString: string;
	private status: PositionStatus = PositionStatus.Empty;
	private edits: vscode.TextEdit[] = [];
	constructor(document: vscode.TextDocument, options: vscode.FormattingOptions)
	{
		this.document = document;
		if (options.insertSpaces)
			this.indentString = ' '.repeat(options.tabSize);
		else
			this.indentString = '\t';
	}

	getEdits()
	{
		return this.edits;
	}

	formatWholeDocument()
	{
		this.edits.length = 0;
		this.status = PositionStatus.Empty;
		for (let i = 0; i < this.document.lineCount; ++i)
		{
			this.formatLine(i);
		}
	}

	private getIndentString(s: PositionStatus)
	{
		return (s & PositionStatus.InBrace) ? this.indentString : '';
	}
	private formatLine(lineNo: number)
	{
		const line = this.document.lineAt(lineNo);
		let status = this.status;
		let pos = 0;
		let pos2: number = 0;
		let text = line.text;
		//pos所在位置是一个新行
		let isBeginOfLine = true;
		const edits = this.edits;
		const createRange = (start: number, length: number) =>
		{
			const s = line.range.start;
			return new Range(s.translate(0, start), s.translate(0, start + length));
		};
		const createPosition = (start: number) =>
		{
			return line.range.start.translate(0, start);
		};

		//是不是空白
		if (line.isEmptyOrWhitespace)
		{
			if (!(status & PositionStatus.InBlockComment) && text.length > 0)
			{
				edits.push(TextEdit.delete(line.range));
			}
			return;
		}
		//是不是空白加上行注释
		if (!(status & PositionStatus.InBlockComment))
		{
			let m = /^(\s*)\/\//.exec(text);
			if (m)
			{
				let indent = this.getIndentString(status);
				if (m[1] !== indent)
				{
					edits.push(TextEdit.replace(createRange(0, m[1].length), indent));
				}
				return;
			}
		}
		//如果初始是块注释
		if (status & PositionStatus.InBlockComment)
		{
			//没有结束块注释
			pos2 = text.indexOf('*/');
			if (pos2 === -1)
			{
				return;
			}
			pos = pos2 + 2;
			status &= ~PositionStatus.InBlockComment;
			isBeginOfLine = false;
		}
		//todo: 这里依然不支持双引号字符串的特殊处理
		while (pos < text.length && pos !== -1)
		{
			let remain = text.substring(pos);
			if (status & PositionStatus.InBlockComment)
			{
				pos2 = text.indexOf('*/');
				if (pos2 === -1)
				{
					break;//break while
				}
				pos = pos2 + 2;
				status &= ~PositionStatus.InBlockComment;
				isBeginOfLine = false;
			}
			else
			{
				if (isBeginOfLine)
				{
					let indent = this.getIndentString(status);
					let m = /^\s*/.exec(remain);
					if (m)
					{
						//后面后首字母不是}
						if (m[0] !== indent && remain[m.index + m[0].length] !== '}')
						{
							this.edits.push(TextEdit.replace(createRange(pos + m.index, m[0].length), indent));
						}
					}
				}
				isBeginOfLine = false;
				let m = /(\{)|(\})|(\/\*)/.exec(remain);
				if (!m)
				{
					break;
				}
				const tmp = m[0];
				if (tmp === '{')
				{
					status |= PositionStatus.InBrace;
				}
				else if (tmp === '}')
				{
					status &= ~PositionStatus.InBrace;
				}
				else if (tmp === '/*')
				{
					status |= PositionStatus.InBlockComment;
				}
				pos = pos + m.index + m[0].length;
			}
		}
		this.status = status;
	}
}

enum TokenType
{
	Empty,
	WhiteSpace,
	Symbol,
	Punc,      //运算符
	StartBlockComment, // "/*"
	StartLineComment,  // "//"
	Comment,
	StartBrace,
	EndBrace,
	StatementEnd,      // ";"
	Other
}

interface Token
{
	readonly type: TokenType;
	readonly text: string;
	readonly pos: number;
	readonly length: number;
}

// class LineTokenizer
// {
// 	private text: string;
// 	private pos = 0;
// 	private peekCache: Token[] = [];
// 	private peeking = false;
// 	private peekViewPos = -1;
// 	constructor(text: string)
// 	{
// 		this.text = text;
// 	}
// 	startPeek()
// 	{
// 		if (this.peeking)
// 			throw new Error('already in peek');
// 		this.peekViewPos = 0;
// 	}
// 	endPeek()
// 	{
// 		this.peeking = false;
// 	}
// 	peekOne()
// 	{
// 		this.startPeek();
// 		let tmp = this.next();
// 		this.endPeek();
// 		return tmp;
// 	}
// 	next()
// 	{
// 		if (this.peeking)
// 		{
// 			let tmp = this.peekCache[this.peekViewPos];
// 			if (tmp)
// 			{
// 				++this.peekViewPos;
// 				return tmp;
// 			}
// 			this.peekViewPos = -1;
// 			tmp = this.doFetchNext();
// 			this.peekCache.push(tmp);
// 			return tmp;
// 		}
// 		else
// 		{
// 			if (this.peekCache.length > 0)
// 				return this.peekCache.unshift();
// 			return this.doFetchNext();
// 		}
// 	}

// 	createEmptyToken()
// 	{
// 		return {
// 			type: TokenType.Empty,
// 			text: '',
// 			pos: this.pos,
// 			length: 0
// 		} as Token;
// 	}
// 	private doFetchNext(): Token
// 	{
// 		const text = this.text;
// 		const startPos = this.pos;
// 		let pos = this.pos;

// 		const createToken = (type: TokenType, text = '') =>
// 		{
// 			return {
// 				type,
// 				text,
// 				pos: startPos,
// 				get length()
// 				{
// 					return this.text.length;
// 				}
// 			} as Token;
// 		};

// 		if (pos >= text.length)
// 		{
// 			return createToken(TokenType.Empty);
// 		}

// 		const firstChar = text[pos];
// 		if (isWhiteSpace(firstChar))
// 		{
// 			let lastpos = text.length;
// 			for (let i = pos + 1; i < text.length; ++i)
// 			{
// 				if (!isWhiteSpace(text[i]))
// 				{
// 					lastpos = i;
// 					break;
// 				}
// 			}
// 			this.pos = lastpos;
// 			return createToken(TokenType.WhiteSpace, text.substring(startPos, lastpos));
// 		}
// 		if (firstChar === '/')
// 		{
// 			const secondChar = text[pos + 1];
// 			if (secondChar === '/')
// 			{
// 				this.pos += 2;
// 				return createToken(TokenType.StartLineComment, '//');
// 			}
// 			if (secondChar === '*')
// 			{
// 				this.pos += 2;
// 				let pos3 = this.text.indexOf('*/', this.pos);
// 				if (pos3 !== -1)
// 				{
// 					this.pos = pos3 + 2;
// 					return createToken(TokenType.Comment, this.text.substring(startPos, this.pos));
// 				}
// 				return createToken(TokenType.StartBlockComment, '/*');
// 			}
// 		}

// 		if (firstChar === ';')
// 		{
// 			this.pos++;
// 			return createToken(TokenType.StatementEnd, ';');
// 		}

// 		if (isPunc(firstChar))
// 		{
// 			this.pos++;
// 			return createToken(TokenType.Punc, ';');
// 		}

// 		if (isSymbolChar(firstChar))
// 		{
// 			let lastpos = text.length;
// 			for (let i = pos + 1; i < text.length; ++i)
// 			{
// 				if (!isWhiteSpace(text[i]))
// 				{
// 					lastpos = i;
// 					break;
// 				}
// 			}
// 			this.pos = lastpos;
// 			return createToken(TokenType.Symbol, text.substring(startPos, lastpos));
// 		}


// 		//
// 		let unknownString = firstChar;
// 		this.pos++;
// 		while (this.pos < text.length)
// 		{
// 			const c = text[this.pos];
// 			if (!isWhiteSpace(c) && !isPunc(c) && ''.indexOf(c) === -1)
// 			{
// 				unknownString += c;
// 				this.pos++;
// 			}
// 			else
// 			{
// 				break;
// 			}
// 		}
// 		return createToken(TokenType.Other, unknownString);
// 	}
// }