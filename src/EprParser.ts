import * as vscode from 'vscode';

export type LineKind = 'none' | 'struct' | 'message';

export interface LineState
{
	hasOpenBrace: boolean;
	hasCloseBrace: boolean;

	kind: LineKind;
	name?: string;

	messageId?: number;

	inBrace: boolean;
}

export class EprParser
{
	private document: vscode.TextDocument;

	readonly lineStates: LineState[] = [];

	/** struct 名字 */
	readonly structs = new Set<string>();

	/** message 名字 -> id */
	readonly messages = new Map<string, number>();

	constructor(document: vscode.TextDocument)
	{
		this.document = document;
		this.parseWholeDocument();
	}

	/* ================== public ================== */

	onDidChangeTextDocument(e: vscode.TextDocumentChangeEvent)
	{
		if (e.document !== this.document) return;
		if (e.contentChanges.length === 0) return;

		const change = e.contentChanges[0];

		const startLine = change.range.start.line;
		const endLine = change.range.end.line;

		const insertedLines =
			change.text.split('\n').length - 1;
		const deletedLines =
			endLine - startLine;

		/* ---- 1. 同步 lineStates 行数 ---- */

		// 删除
		if (deletedLines > 0)
		{
			for (let i = 0; i < deletedLines; i++)
			{
				this.removeLineState(startLine + 1);
			}
		}

		// 插入
		if (insertedLines > 0)
		{
			const emptyStates = Array.from(
				{ length: insertedLines },
				() => this.createEmptyLineState()
			);

			this.lineStates.splice(
				startLine + 1,
				0,
				...emptyStates
			);
		}

		/* ---- 2. 从 startLine 开始重算 ---- */
		this.rebuildFromLine(startLine);
	}

	/* ================== parsing ================== */

	private parseWholeDocument()
	{
		this.lineStates.length = 0;
		this.structs.clear();
		this.messages.clear();

		let inBrace = false;

		for (let i = 0; i < this.document.lineCount; i++)
		{
			const text = this.document.lineAt(i).text;
			const state = this.parseLine(text);

			if (state.hasOpenBrace && !state.hasCloseBrace)
				inBrace = true;
			else if (!state.hasOpenBrace && state.hasCloseBrace)
				inBrace = false;

			state.inBrace = inBrace && !state.hasOpenBrace;
			this.lineStates.push(state);
			this.collectDefinition(state);
		}
	}

	private rebuildFromLine(startLine: number)
	{
		// 先移除 startLine 之后旧的定义
		let inBrace;
		let lastLine = this.lineStates[startLine - 1];
		if (lastLine)
		{
			inBrace = lastLine.inBrace || lastLine.hasOpenBrace && !lastLine.hasCloseBrace;
		}
		else
		{
			inBrace = false;
		}

		for (
			let i = startLine;
			i < this.document.lineCount;
			i++
		)
		{
			const text = this.document.lineAt(i).text;
			const newState = this.parseLine(text);

			if (newState.hasOpenBrace && !newState.hasCloseBrace)
				inBrace = true;
			else if (!newState.hasOpenBrace && newState.hasCloseBrace)
				inBrace = false;

			newState.inBrace = inBrace && !newState.hasOpenBrace;

			const oldState = this.lineStates[i];

			if (oldState && this.isSameState(oldState, newState))
			{
				break; // 状态稳定
			}

			this.lineStates[i] = newState;
		}

		// 重新收集定义
		this.rebuildDefinitions();
	}

	private parseLine(text: string): LineState
	{
		const state = this.createEmptyLineState();

		// 仅记录是否包含对应字符（详细顺序由 computeDepthAfterLine 处理）
		state.hasOpenBrace = text.indexOf('{') >= 0;
		state.hasCloseBrace = text.indexOf('}') >= 0;

		// struct
		const structMatch =
			/^\s*struct\s+([A-Za-z_][A-Za-z0-9_]*)\b/.exec(text);

		if (structMatch)
		{
			state.kind = 'struct';
			state.name = structMatch[1];
			return state;
		}

		// message
		const messageMatch =
			/^\s*message\s+([A-Za-z_][A-Za-z0-9_]*)\s*(?=:(\d+))\s*.*$/.exec(
				text
			);

		if (messageMatch)
		{
			state.kind = 'message';
			state.name = messageMatch[1];
			if (messageMatch[2])
				state.messageId = Number(messageMatch[2]);
			else
				state.messageId = undefined;
			return state;
		}

		return state;
	}

	/* ================== helpers ================== */

	private createEmptyLineState(): LineState
	{
		return {
			hasOpenBrace: false,
			hasCloseBrace: false,
			kind: 'none',
			inBrace: false,
		};
	}

	private isSameState(a: LineState, b: LineState): boolean
	{
		return (
			a.hasOpenBrace === b.hasOpenBrace &&
			a.hasCloseBrace === b.hasCloseBrace &&
			a.kind === b.kind &&
			a.name === b.name &&
			a.messageId === b.messageId &&
			a.inBrace === b.inBrace
		);
	}



	private collectDefinition(state: LineState)
	{
		if (state.kind === 'struct' && state.name)
		{
			this.structs.add(state.name);
		}

		if (
			state.kind === 'message' &&
			state.name &&
			state.messageId !== undefined
		)
		{
			this.messages.set(state.name, state.messageId);
		}
	}

	private rebuildDefinitions()
	{
		this.structs.clear();
		this.messages.clear();

		for (const state of this.lineStates)
		{
			this.collectDefinition(state);
		}
	}

	private removeLineState(index: number)
	{
		const state = this.lineStates[index];
		if (!state) return;

		// 移除定义
		if (state.kind === 'struct' && state.name)
		{
			this.structs.delete(state.name);
		}

		if (state.kind === 'message' && state.name)
		{
			this.messages.delete(state.name);
		}

		this.lineStates.splice(index, 1);
	}

	// new public helper
	isInBrace(line: number): boolean
	{
		if (line < 0 || line >= this.lineStates.length) return false;
		return this.lineStates[line].inBrace;
	}

	getNextMsgId(): number
	{
		let maxId = 0;
		for (const id of this.messages.values())
		{
			if (id > maxId)
			{
				maxId = id;
			}
		}
		return maxId + 1;
	}
}
