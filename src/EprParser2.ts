
import * as vscode from 'vscode';
export enum LineEndStatus
{
	Empty = 0,
	InBrace = 1 << 0,
	InBlockComment = 1 << 1,
}

interface IMsgDefine
{
	name: string;
	protoId: number | null;
	isMsg: number;//0 struct ,1 message
}

export class LineStatus
{
	readonly lineEnd: LineEndStatus;
	readonly msg: IMsgDefine | null;
	constructor(lineEnd: LineEndStatus, msg: IMsgDefine | null = null)
	{
		this.lineEnd = lineEnd;
		this.msg = msg;
	}

	toString()
	{
		let s: string;
		if (this.lineEnd === LineEndStatus.Empty)
		{
			s = 'Empty';
		}
		else
		{
			let parts: string[] = [];
			if (this.lineEnd & LineEndStatus.InBrace)
				parts.push('InBrace');
			if (this.lineEnd & LineEndStatus.InBlockComment)
				parts.push('InBlockComment');
			s = parts.join('|');
		}
		let msg: string = '';
		if (this.msg)
		{
			msg = `, Msg(name=${this.msg.name}, protoId=${this.msg.protoId})`;
		}
		return `LineStatus(${s}${msg})`;
	}
}


function readNextSymbol(text: string, pos: number): { token: string, newPos: number; } | null
{
	//skip whitespace
	while (pos < text.length && /\s/.test(text[pos]))
	{
		pos++;
	}

	if (/[a-zA-Z_]/.test(text[pos]))
	{
		let start = pos;
		pos++;
		while (pos < text.length && /[a-zA-Z0-9_]/.test(text[pos]))
		{
			pos++;
		}
		return { token: text.substring(start, pos), newPos: pos };
	}
	return null;
}

export class EprParser2
{
	readonly lines: LineStatus[] = [];
	readonly msgDefineLines: Set<LineStatus> = new Set<LineStatus>();
	constructor(document: vscode.TextDocument)
	{
		this.parseWholeDocument(document);
	}

	private parseWholeDocument(document: vscode.TextDocument)
	{
		this.lines.length = 0;
		this.msgDefineLines.clear();
		let prevStatus: LineStatus | undefined = undefined;
		for (let i = 0; i < document.lineCount; i++)
		{
			let lineText = document.lineAt(i).text;
			let status = this.parseLine(lineText, prevStatus);
			prevStatus = status;
			this.lines.push(status);
			if (status.msg)
			{
				this.msgDefineLines.add(status);
			}
		}
	}

	onDidChangeTextDocument(e: vscode.TextDocumentChangeEvent)
	{
		for (const change of e.contentChanges)
		{
			const startLine = change.range.start.line;
			const endLine = change.range.end.line;

			const insertedLines = change.text.split('\n').length - 1;
			const deletedLines = endLine - startLine;

			if (deletedLines > 0)
			{
				for (let i = 0; i < deletedLines; i++)
				{
					this.onRemoveLineStatus(this.lines[startLine + i + 1]);
					//this.lines.splice(startLine + 1, 1);
				}
				this.lines.splice(startLine + 1, deletedLines);
			}

			if (insertedLines > 0)
			{
				const emptyStates = Array.from(
					{ length: insertedLines },
					() => new LineStatus(LineEndStatus.Empty, null)
				);

				this.lines.splice(
					startLine + 1,
					0,
					...emptyStates
				);
			}
			this.rebuildFromLine(e.document, startLine);
		}

	}
	private rebuildFromLine(document: vscode.TextDocument, startLine: number)
	{
		for (let i = startLine; i < document.lineCount; i++)
		{
			let text = document.lineAt(i).text;
			let prevStatus = this.lines[i - 1] ?? undefined;
			let newStatus = this.parseLine(text, prevStatus);
			let oldStatus = this.lines[i];
			if (this.isSameStatus(oldStatus, newStatus))
			{
				this.lines[i] = newStatus; // 保持 msg 定义不变
				break;
			}

			this.onRemoveLineStatus(oldStatus);
			this.lines[i] = newStatus;
		}
	}
	private onRemoveLineStatus(s: LineStatus)
	{
		this.msgDefineLines.delete(s);
	}

	private parseLine(text: string, prevStatus?: LineStatus): LineStatus
	{
		let status = prevStatus ? prevStatus.lineEnd : LineEndStatus.Empty;
		let msgDefine: IMsgDefine | null = null;
		let parseCodeBlock = (text: string) =>
		{
			if ((status & LineEndStatus.InBrace) === 0)
			{
				//不在大括号内，解析message或struct定义
				let ret = readNextSymbol(text, 0);
				if (ret && (ret.token === 'message' || ret.token === 'struct'))
				{
					let isMsg = ret.token === 'message';
					ret = readNextSymbol(text, ret.newPos);
					if (ret)
					{
						msgDefine = { name: ret.token, protoId: null, isMsg: isMsg ? 1 : 0 };
						if (isMsg)
						{
							let remain = text.substring(ret.newPos);
							let m = /\s*:\s*(\d+)/.exec(remain);
							if (m)
							{
								msgDefine.protoId = parseInt(m[1], 10);
							}
						}
					}
				}
			}
		};
		let pos = 0;
		while (pos < text.length)
		{
			if (status & LineEndStatus.InBlockComment)
			{
				let pos2 = text.indexOf('*/', pos);
				if (pos2 === -1) break;
				pos = pos2 + 2;
				status &= ~LineEndStatus.InBlockComment;
				continue;
			}
			else
			{
				//搜索第一个 {,},//,/*
				let re = /\{|\}|(\/\/)|(\/\*)/g;
				re.lastIndex = pos;
				let m = re.exec(text);
				if (!m) 
				{
					parseCodeBlock(text.substring(pos));
					break;
				}
				parseCodeBlock(text.substring(pos, m.index));
				pos = m.index + m[0].length;
				let tmp = m[0];
				if (tmp === '//') 
				{
					//后面整行都是行注释了
					break;
				}
				else if (tmp === '/*')
				{
					status |= LineEndStatus.InBlockComment;
				}
				else if (tmp === '{')
				{
					status |= LineEndStatus.InBrace;
				}
				else if (tmp === '}')
				{
					status &= ~LineEndStatus.InBrace;
				}
				else
				{
					throw new Error('unreachable, tmp = ' + tmp);
				}
			}
		}
		return new LineStatus(status, msgDefine);
	}

	private isSameStatus(s1: LineStatus, s2: LineStatus): boolean
	{
		return s1.lineEnd === s2.lineEnd;
	}

	getNextMsgId(): number
	{
		let maxId = 0;
		for (const item of this.msgDefineLines)
		{
			if (item.msg && item.msg.protoId !== null)
			{
				if (item.msg.protoId > maxId)
				{
					maxId = item.msg.protoId;
				}
			}
		}
		return maxId + 1;
	}

	getLineStatus(line: number): LineStatus | null
	{
		return this.lines[line];
	}

	getLineStartStatus(line:number):LineEndStatus
	{
		const s = this.getLineStatus(line-1);
		if (s) return s.lineEnd;
		return LineEndStatus.Empty;
	}

	isInBrace(line: number): boolean
	{
		let status = this.getLineStatus(line - 1);
		if (status)
		{
			return (status.lineEnd & LineEndStatus.InBrace) !== 0 &&
				(status.lineEnd & LineEndStatus.InBlockComment) === 0;
		}
		return false;
	}
	isInBlockComment(line: number): boolean
	{
		let status = this.getLineStatus(line);
		if (status)
		{
			return (status.lineEnd & LineEndStatus.InBlockComment) !== 0;
		}
		return false;
	}

	getNextFieldId(document: vscode.TextDocument, line: number): number 
	{
		let maxId = 0;
		for (let i = line; i >= 0; i--)
		{
			const text = document.lineAt(i).text;
			if (text.includes('{')) break;

			const m = text.match(/:\s*(\d+)/);
			if (m)
			{
				maxId = Math.max(maxId, parseInt(m[1], 10));
			}
		}
		for (let i = line + 1; ; i++)
		{
			if (i >= document.lineCount) break;
			const text = document.lineAt(i).text;
			if (text.includes('}')) break;
			if (text.match(/^\s*(message|struct)\b/)) break;

			const m = text.match(/:\s*(\d+)/);
			if (m)
			{
				maxId = Math.max(maxId, parseInt(m[1], 10));
			}
		}
		return maxId > 0 ? maxId + 1 : 1;
	}

	getTypeNamesFromLine(lineNo: number)
	{
		let ret: IMsgDefine[] = [];
		for (const item of this.msgDefineLines)
		{
			if (item.msg)
			{
				ret.push(item.msg);
			}
		}
		return ret;
	}
}