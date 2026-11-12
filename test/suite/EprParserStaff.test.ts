import * as assert from 'assert';
import * as vscode from 'vscode';
import { EprParser } from '../../src/EprParser';
import {
	computeDeclarationTagInsertion,
	computeFieldTagInsertion,
	provideCompletionItems,
} from '../../src/EprParserStaff';

let g_UriSeq = 0;

function createDocument(content: string, languageId = 'eproto'): vscode.TextDocument
{
	const lines = content.split('\n');
	const document: any = {
		uri: vscode.Uri.parse(`untitled:epr-test-${g_UriSeq++}.epr`),
		languageId,
		version: 1,
		lineCount: lines.length,
		lineAt(line: number)
		{
			const text = lines[line] ?? '';
			return {
				lineNumber: line,
				text,
				range: new vscode.Range(
					new vscode.Position(line, 0),
					new vscode.Position(line, text.length)
				),
			};
		},
	};
	return document;
}

function joinLines(...items: string[]): string
{
	return items.join('\n');
}

function labelsAt(content: string, line: number, character: number): string[] | undefined
{
	const document = createDocument(content);
	const items = provideCompletionItems(document, new vscode.Position(line, character));
	return items?.map(item =>
		typeof item.label === 'string' ? item.label : item.label.label);
}

function contains(labels: string[] | undefined, name: string): boolean
{
	return !!labels && labels.includes(name);
}

suite('EprParserStaff Tests', () =>
{
	test('suggests decl keywords and missing directives at top level', () =>
	{
		const labels = labelsAt(joinLines('protoname=Foo;', ''), 1, 0);
		assert.ok(contains(labels, 'struct'));
		assert.ok(contains(labels, 'message'));
		assert.ok(contains(labels, 'enum'));
		assert.ok(contains(labels, 'userclass'));
		assert.ok(contains(labels, 'import'));
		assert.ok(contains(labels, 'protoid'));
		assert.ok(contains(labels, 'interfacestyle'));
		assert.ok(!contains(labels, 'protoname'), '已有指令不应重复提示');
	});

	test('keeps suggesting directives while a partial name is typed', () =>
	{
		const labels = labelsAt('prot', 0, 4);
		assert.ok(contains(labels, 'protoname'));
		assert.ok(contains(labels, 'protoid'));
	});

	test('suggests builtin and previously declared types inside a body', () =>
	{
		const content = joinLines(
			'struct MyType',
			'{',
			'    int a:1;',
			'};',
			'',
			'message M:2',
			'{',
			'    ',
			'};',
			'',
			'struct Later',
			'{',
			'    int x:1;',
			'};'
		);

		const labels = labelsAt(content, 7, 4);
		assert.ok(contains(labels, 'card'));
		assert.ok(contains(labels, 'int'));
		assert.ok(contains(labels, 'string'));
		assert.ok(contains(labels, 'msgtype'));
		assert.ok(contains(labels, 'MyType'));
		assert.ok(contains(labels, 'M'));
		assert.ok(!contains(labels, 'Later'), '不应提示后面才声明的类型');
	});

	test('suggests struct modifiers in a message header', () =>
	{
		const labels = labelsAt('message M ', 0, 10);
		assert.ok(contains(labels, 'c2s'));
		assert.ok(contains(labels, 's2c'));
		assert.ok(contains(labels, 'equal'));
		assert.ok(contains(labels, 'responses'));
		assert.ok(contains(labels, 'extends'));
		assert.ok(contains(labels, 'ts'));
	});

	test('does not repeat an already used modifier', () =>
	{
		const labels = labelsAt('message M s2c ', 0, 14);
		assert.ok(!contains(labels, 's2c'));
		assert.ok(contains(labels, 'c2s'));
	});

	test('suggests the next structure tag after a colon in a header', () =>
	{
		const labels = labelsAt('message M:', 0, 10);
		assert.deepStrictEqual(labels, ['1']);
	});

	test('suggests the next field tag after a colon in a field', () =>
	{
		const content = joinLines(
			'struct S',
			'{',
			'    int a:1;',
			'    int b:'
		);
		const labels = labelsAt(content, 3, 10);
		assert.deepStrictEqual(labels, ['2']);
	});

	test('suggests directive values', () =>
	{
		const labels = labelsAt('interfacestyle = ', 0, 17);
		assert.deepStrictEqual(labels, ['stdcsgame', 'stdcs', 'equal', 'nointerface']);
	});

	test('suggests boolean and enum default values', () =>
	{
		const boolContent = joinLines(
			'struct S',
			'{',
			'    bool flag:1 = '
		);
		const boolLabels = labelsAt(boolContent, 2, 19);
		assert.ok(contains(boolLabels, 'true'));
		assert.ok(contains(boolLabels, 'false'));

		const enumContent = joinLines(
			'enum E',
			'{',
			'    A = 1;',
			'    B = 2;',
			'};',
			'struct S',
			'{',
			'    E e:1 = '
		);
		const enumLabels = labelsAt(enumContent, 7, 13);
		assert.ok(contains(enumLabels, 'A'));
		assert.ok(contains(enumLabels, 'B'));
	});

	test('returns nothing inside line and block comments', () =>
	{
		const lineComment = joinLines(
			'struct S',
			'{',
			'    int a:1; // comment'
		);
		const lineText = lineComment.split('\n')[2];
		assert.strictEqual(labelsAt(lineComment, 2, lineText.length), undefined);

		const blockComment = joinLines(
			'struct S',
			'{',
			'    /*',
			'    abc'
		);
		assert.strictEqual(labelsAt(blockComment, 3, 7), undefined);
	});

	test('returns nothing outside epr documents', () =>
	{
		const document = createDocument('struct S', 'plaintext');
		assert.strictEqual(
			provideCompletionItems(document, new vscode.Position(0, 0)),
			undefined
		);
	});

	test('computes a field tag insertion', () =>
	{
		const content = joinLines(
			'struct S',
			'{',
			'    int a:1;',
			'    int b;',
			'};'
		);
		const document = createDocument(content);
		const parser = new EprParser(document);

		assert.deepStrictEqual(
			computeFieldTagInsertion(document, parser, 3),
			{ line: 3, character: 9, text: ':2' }
		);
		assert.strictEqual(computeFieldTagInsertion(document, parser, 2), null, '已有 tag 不应重复插入');
		assert.strictEqual(computeFieldTagInsertion(document, parser, 0), null, '结构体外部不插入');
		assert.strictEqual(computeFieldTagInsertion(document, parser, 4), null, '结束行不插入');
	});

	test('computes a declaration tag insertion', () =>
	{
		const newLineContent = joinLines(
			'message Foo',
			'{',
			'    int a:1;',
			'};'
		);
		const newLineDocument = createDocument(newLineContent);
		const newLineParser = new EprParser(newLineDocument);
		assert.deepStrictEqual(
			computeDeclarationTagInsertion(newLineDocument, newLineParser, 0),
			{ line: 0, character: 11, text: ':1' }
		);

		const braceContent = joinLines(
			'struct A:7',
			'{',
			'    int a:1;',
			'};',
			'message Bar {'
		);
		const braceDocument = createDocument(braceContent);
		const braceParser = new EprParser(braceDocument);
		assert.deepStrictEqual(
			computeDeclarationTagInsertion(braceDocument, braceParser, 4),
			{ line: 4, character: 11, text: ':8' }
		);

		assert.strictEqual(
			computeDeclarationTagInsertion(braceDocument, braceParser, 0),
			null,
			'已有 tag 不应重复插入'
		);
	});

	test('does not add a tag to enums, userclasses or body lines', () =>
	{
		const enumContent = 'enum E { A };';
		const enumDocument = createDocument(enumContent);
		const enumParser = new EprParser(enumDocument);
		assert.strictEqual(computeDeclarationTagInsertion(enumDocument, enumParser, 0), null);

		const userclassContent = 'userclass X extends Y;';
		const userclassDocument = createDocument(userclassContent);
		const userclassParser = new EprParser(userclassDocument);
		assert.strictEqual(computeDeclarationTagInsertion(userclassDocument, userclassParser, 0), null);

		const bodyContent = joinLines(
			'struct S',
			'{',
			'    int a:1;',
			'};'
		);
		const bodyDocument = createDocument(bodyContent);
		const bodyParser = new EprParser(bodyDocument);
		assert.strictEqual(computeDeclarationTagInsertion(bodyDocument, bodyParser, 2), null);
	});
});
