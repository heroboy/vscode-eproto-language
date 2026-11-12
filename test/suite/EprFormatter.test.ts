import * as assert from 'assert';
import * as vscode from 'vscode';
import { EprFormatter } from '../../src/EprFormatter';

const DEFAULT_OPTIONS: vscode.FormattingOptions = { tabSize: 4, insertSpaces: true };

/**
 * 用行数组拼接文本，便于在用例中直观看到缩进与行尾空白。
 */
function lines(...items: string[]): string
{
	return items.join('\n');
}

/**
 * Helper: Create a mock TextDocument to test EprFormatter
 */
function createTestDocument(content: string): vscode.TextDocument
{
	const docLines = content.split('\n');

	const mockDoc: any = {
		lineCount: docLines.length,
		lineAt: (lineNo: number) =>
		{
			const text = docLines[lineNo] || '';
			return {
				lineNumber: lineNo,
				text: text,
				range: new vscode.Range(
					new vscode.Position(lineNo, 0),
					new vscode.Position(lineNo, text.length)
				),
				rangeIncludingLineBreak: new vscode.Range(
					new vscode.Position(lineNo, 0),
					new vscode.Position(lineNo + 1, 0)
				),
				firstNonWhitespaceCharacterIndex: text.search(/\S/),
				isEmptyOrWhitespace: /^\s*$/.test(text)
			};
		}
	};

	return mockDoc;
}

function getLineStartOffsets(content: string): number[]
{
	const offsets: number[] = [0];
	for (let i = 0; i < content.length; i++)
	{
		if (content[i] === '\n')
		{
			offsets.push(i + 1);
		}
	}
	return offsets;
}

function positionToOffset(content: string, pos: vscode.Position): number
{
	const offsets = getLineStartOffsets(content);
	const lineStart = offsets[pos.line] ?? content.length;
	return lineStart + pos.character;
}

function applyEdits(content: string, edits: vscode.TextEdit[]): string
{
	const sorted = [...edits].sort((a, b) =>
	{
		if (a.range.start.line !== b.range.start.line)
		{
			return b.range.start.line - a.range.start.line;
		}
		return b.range.start.character - a.range.start.character;
	});

	let out = content;
	for (const edit of sorted)
	{
		const start = positionToOffset(out, edit.range.start);
		const end = positionToOffset(out, edit.range.end);
		out = out.slice(0, start) + edit.newText + out.slice(end);
	}
	return out;
}

function createFormatter(input: string, options?: vscode.FormattingOptions): EprFormatter
{
	const doc = createTestDocument(input);
	return new EprFormatter(doc, options ?? DEFAULT_OPTIONS);
}

function format(input: string, options?: vscode.FormattingOptions): string
{
	const formatter = createFormatter(input, options);
	formatter.formatWholeDocument();
	return applyEdits(input, formatter.getEdits());
}

function testFormatter(input: string, expectOutput: string, options?: vscode.FormattingOptions): void
{
	assert.strictEqual(format(input, options), expectOutput);
}

suite('EprFormatter Tests', () =>
{
	test('formats a simple struct', () =>
	{
		const input = lines(
			'struct MyStruct',
			'{',
			'int field1:1;',
			'}'
		);
		const expectOutput = lines(
			'struct MyStruct',
			'{',
			'    int field1:1;',
			'}'
		);
		testFormatter(input, expectOutput);
	});

	test('produces no edits for an already formatted document', () =>
	{
		const input = lines(
			'protoname=TestProto;',
			'protoid=101;',
			'',
			'struct MyStruct',
			'{',
			'    int field1:1;',
			'    // comment',
			'};'
		);
		const formatter = createFormatter(input);
		formatter.formatWholeDocument();
		assert.strictEqual(formatter.getEdits().length, 0);
	});

	test('clears whitespace-only lines', () =>
	{
		const input = lines(
			'struct MyStruct',
			'{',
			'    ',
			'int field1:1;',
			'}'
		);
		const expectOutput = lines(
			'struct MyStruct',
			'{',
			'',
			'    int field1:1;',
			'}'
		);
		testFormatter(input, expectOutput);
	});

	test('fixes line comment indentation', () =>
	{
		const input = lines(
			'struct MyStruct',
			'{',
			'   // This is a comment',
			'    int field1:1;',
			'}'
		);
		const expectOutput = lines(
			'struct MyStruct',
			'{',
			'    // This is a comment',
			'    int field1:1;',
			'}'
		);
		testFormatter(input, expectOutput);
	});

	test('ignores braces inside line comments', () =>
	{
		//真实文件 Pai9Proto.epr 中被注释掉的代码，旧实现会被这些花括号带偏深度
		const input = lines(
			'struct Pai9Scene',
			'{',
			'//  if ((!prevScene) && scene.gamePhase == gpKaiPai)',
			'//  {',
			'//         这里把scene中的results加入历史',
			'//  }',
			'int scene:1;',
			'//  }',
			'int other:2;',
			'};'
		);
		const expectOutput = lines(
			'struct Pai9Scene',
			'{',
			'    //  if ((!prevScene) && scene.gamePhase == gpKaiPai)',
			'    //  {',
			'    //         这里把scene中的results加入历史',
			'    //  }',
			'    int scene:1;',
			'    //  }',
			'    int other:2;',
			'};'
		);
		testFormatter(input, expectOutput);
	});

	test('indents the first line of a block comment but leaves its body untouched', () =>
	{
		const input = lines(
			'struct MyStruct',
			'{',
			'/* block comment',
			'       continues here */',
			'int field1:1;',
			'}'
		);
		const expectOutput = lines(
			'struct MyStruct',
			'{',
			'    /* block comment',
			'       continues here */',
			'    int field1:1;',
			'}'
		);
		testFormatter(input, expectOutput);
	});

	test('ignores braces inside block comments', () =>
	{
		const input = lines(
			'struct S',
			'{',
			'/*',
			'if (x) {',
			'}',
			'*/',
			'int a:1;',
			'};'
		);
		const expectOutput = lines(
			'struct S',
			'{',
			'    /*',
			'if (x) {',
			'}',
			'*/',
			'    int a:1;',
			'};'
		);
		testFormatter(input, expectOutput);
	});

	test('ignores braces and comment markers inside strings', () =>
	{
		const input = lines(
			'struct S',
			'{',
			'string a:1 = "{ // }";',
			'int b:2;',
			'};'
		);
		const expectOutput = lines(
			'struct S',
			'{',
			'    string a:1 = "{ // }";',
			'    int b:2;',
			'};'
		);
		testFormatter(input, expectOutput);
	});

	test('uses tab indentation when insertSpaces is false', () =>
	{
		const input = lines(
			'struct MyStruct',
			'{',
			'int field1:1;',
			'}'
		);
		const expectOutput = lines(
			'struct MyStruct',
			'{',
			'\tint field1:1;',
			'}'
		);
		testFormatter(input, expectOutput, { tabSize: 4, insertSpaces: false });
	});

	test('indents nested braces by the full depth', () =>
	{
		const input = lines(
			'message TestMsg:1',
			'{',
			'MyStruct fieldX:1;',
			'{',
			'int nested:1;',
			'}',
			'}'
		);
		const expectOutput = lines(
			'message TestMsg:1',
			'{',
			'    MyStruct fieldX:1;',
			'    {',
			'        int nested:1;',
			'    }',
			'}'
		);
		testFormatter(input, expectOutput);
	});

	test('dedents a closing brace to match the current depth', () =>
	{
		const input = lines(
			'struct MyStruct',
			'{',
			'    int field1:1;',
			'        }'
		);
		const expectOutput = lines(
			'struct MyStruct',
			'{',
			'    int field1:1;',
			'}'
		);
		testFormatter(input, expectOutput);
	});

	test('formats multi-line array default values', () =>
	{
		const input = lines(
			'struct S',
			'{',
			'int a:1[3] = {',
			'1,',
			'2,',
			'3',
			'};',
			'};'
		);
		const expectOutput = lines(
			'struct S',
			'{',
			'    int a:1[3] = {',
			'        1,',
			'        2,',
			'        3',
			'    };',
			'};'
		);
		testFormatter(input, expectOutput);
	});

	test('clamps extra closing braces to depth zero', () =>
	{
		const input = lines(
			'    }',
			'  }',
			'struct S',
			'{',
			'int a:1;',
			'};'
		);
		const expectOutput = lines(
			'}',
			'}',
			'struct S',
			'{',
			'    int a:1;',
			'};'
		);
		testFormatter(input, expectOutput);
	});

	test('dedents a line that starts with a block comment and then a closing brace', () =>
	{
		const input = lines(
			'struct S',
			'{',
			'    int a:1;',
			'/* end */ };'
		);
		const expectOutput = lines(
			'struct S',
			'{',
			'    int a:1;',
			'/* end */ };'
		);
		testFormatter(input, expectOutput);
	});

	test('keeps top-level directives and empty lines unchanged', () =>
	{
		const input = lines(
			'protoname=TestProto;',
			'protoid=101;',
			'',
			'struct A',
			'{',
			'',
			'};'
		);
		testFormatter(input, input);
	});

	test('supports both 4-space and 2-space indentation', () =>
	{
		const input = lines(
			'struct MyStruct',
			'{',
			'int field1:1;',
			'}'
		);

		const expect2 = lines(
			'struct MyStruct',
			'{',
			'  int field1:1;',
			'}'
		);
		testFormatter(input, expect2, { tabSize: 2, insertSpaces: true });

		const expect4 = lines(
			'struct MyStruct',
			'{',
			'    int field1:1;',
			'}'
		);
		testFormatter(input, expect4, { tabSize: 4, insertSpaces: true });
	});

	test('formats a real-world protocol sample and is idempotent', () =>
	{
		const input = lines(
			'protoname=DragonFragment;',
			'protoid=101;',
			'interfacestyle=stdcsgame;',
			'',
			'message BetSuccess:11  s2c',
			'{',
			'//数组长度对应了count',
			'BetResult results:1[];',
			'int scene:2;',
			'/*',
			'	0 表示正常结算了，和之前一样。',
			'	1 表示需要进行礼物积分兑换。',
			'*/',
			'int _dragonScoreMode:5 = 0;',
			'};'
		);
		const expectOutput = lines(
			'protoname=DragonFragment;',
			'protoid=101;',
			'interfacestyle=stdcsgame;',
			'',
			'message BetSuccess:11  s2c',
			'{',
			'    //数组长度对应了count',
			'    BetResult results:1[];',
			'    int scene:2;',
			'    /*',
			'	0 表示正常结算了，和之前一样。',
			'	1 表示需要进行礼物积分兑换。',
			'*/',
			'    int _dragonScoreMode:5 = 0;',
			'};'
		);

		const formatted = format(input);
		assert.strictEqual(formatted, expectOutput);

		//再次格式化不应产生任何改动
		const second = createFormatter(formatted);
		second.formatWholeDocument();
		assert.strictEqual(second.getEdits().length, 0);
	});

	test('handles empty and whitespace-only documents', () =>
	{
		assert.strictEqual(format(''), '');
		assert.strictEqual(format('    '), '');
	});
});
