import * as assert from 'assert';
import { test, suite } from 'mocha';
import * as vscode from 'vscode';
import { EprFormatter } from '../../src/EprFormatter';

/**
 * Helper: Create a mock TextDocument to test EprFormatter
 */
function createTestDocument(content: string): vscode.TextDocument {
	const lines = content.split('\n');
	
	const mockDoc: any = {
		lineCount: lines.length,
		lineAt: (lineNo: number) => {
			const text = lines[lineNo] || '';
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

function getLineStartOffsets(content: string): number[] {
	const offsets: number[] = [0];
	for (let i = 0; i < content.length; i++) {
		if (content[i] === '\n') {
			offsets.push(i + 1);
		}
	}
	return offsets;
}

function positionToOffset(content: string, pos: vscode.Position): number {
	const offsets = getLineStartOffsets(content);
	const lineStart = offsets[pos.line] ?? content.length;
	return lineStart + pos.character;
}

function applyEdits(content: string, edits: vscode.TextEdit[]): string {
	const sorted = [...edits].sort((a, b) => {
		if (a.range.start.line !== b.range.start.line) {
			return b.range.start.line - a.range.start.line;
		}
		return b.range.start.character - a.range.start.character;
	});

	let out = content;
	for (const edit of sorted) {
		const start = positionToOffset(out, edit.range.start);
		const end = positionToOffset(out, edit.range.end);
		out = out.slice(0, start) + edit.newText + out.slice(end);
	}
	return out;
}

function testFormatter(
	input: string,
	expectOutput: string,
	options?: vscode.FormattingOptions
): void {
	const doc = createTestDocument(input);
	const formatter = new EprFormatter(doc, options ?? { tabSize: 4, insertSpaces: true });
	formatter.formatWholeDocument();
	const actual = applyEdits(input, formatter.getEdits());
	assert.strictEqual(actual, expectOutput);
}

suite('EprFormatter Tests', () => {
	test('should format simple struct with indentation', () => {
		const input = `struct MyStruct
{
int field1:1;
}`;
		const expectOutput = `struct MyStruct
{
    int field1:1;
}`;
		testFormatter(input, expectOutput);
	});

	test('should remove empty whitespace lines', () => {
		const input = `struct MyStruct
{
    
int field1:1;
}`;
		const expectOutput = `struct MyStruct
{

    int field1:1;
}`;
		testFormatter(input, expectOutput);
	});

	test('should fix line comment indentation', () => {
		const input = `struct MyStruct
{
   // This is a comment
    int field1:1;
}`;
		const expectOutput = `struct MyStruct
{
    // This is a comment
    int field1:1;
}`;
		testFormatter(input, expectOutput);
	});

	test('should handle block comments', () => {
		const input = `struct MyStruct
{
/* block comment
       continues here */
int field1:1;
}`;
		const expectOutput = `struct MyStruct
{
    /* block comment
       continues here */
    int field1:1;
}`;
		testFormatter(input, expectOutput);
	});

	test('should use tab indentation when insertSpaces is false', () => {
		const input = `struct MyStruct
{
int field1:1;
}`;
		const expectOutput = `struct MyStruct
{
	int field1:1;
}`;
		testFormatter(input, expectOutput, { tabSize: 4, insertSpaces: false });
	});

	test('should handle nested braces', () => {
		const input = `message TestMsg:1
{
    MyStruct fieldX:1;
    {
        int nested:1;
    }
}`;
		const expectOutput = `message TestMsg:1
{
    MyStruct fieldX:1;
    {
    int nested:1;
    }
}`;
		testFormatter(input, expectOutput);
	});

	test('should handle closing brace indentation', () => {
		const input = `struct MyStruct
{
    int field1:1;
    }`;
		const expectOutput = `struct MyStruct
{
    int field1:1;
    }`;
		testFormatter(input, expectOutput);
	});

	test('should format real-world EPR struct', () => {
		const input = `struct MyStruct
{
	int field1:1;
	int field2:2 = 123; //support default value
	char array:3[];     //array write method
	short array2:4[12]; //fixed array
};

message SomeMessage:2 s2c
{
	MyStruct fieldX:1; //other message/struct can be used as type
};`;
		const expectOutput = `struct MyStruct
{
    int field1:1;
    int field2:2 = 123; //support default value
    char array:3[];     //array write method
    short array2:4[12]; //fixed array
};

message SomeMessage:2 s2c
{
    MyStruct fieldX:1; //other message/struct can be used as type
};`;
		testFormatter(input, expectOutput);
	});

	test('should handle multiple editing operations', () => {
		const input = `protoname=TestProto;
protoid=101;

struct MyStruct
{
int field1:1;
   int field2:2;
}`;
		const expectOutput = `protoname=TestProto;
protoid=101;

struct MyStruct
{
    int field1:1;
    int field2:2;
}`;
		testFormatter(input, expectOutput);
	});

	test('should support both 4-space and 2-space indentation', () => {
		const input = `struct MyStruct
{
int field1:1;
}`;

		const expect2 = `struct MyStruct
{
  int field1:1;
}`;
		testFormatter(input, expect2, { tabSize: 2, insertSpaces: true });

		const expect4 = `struct MyStruct
{
    int field1:1;
}`;
		testFormatter(input, expect4, { tabSize: 4, insertSpaces: true });
	});
});

