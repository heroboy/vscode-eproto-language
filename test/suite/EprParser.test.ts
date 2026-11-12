import * as assert from 'assert';
import {
	EprDeclKind,
	EprLineMode,
	EprParser,
	EprTextDocumentLike,
	parseFieldHeader,
} from '../../src/EprParser';
import { EprLineLexer } from '../../src/EprLexer';

function createDocument(content: string): EprTextDocumentLike
{
	const lines = content.split('\n');
	return {
		lineCount: lines.length,
		lineAt(line: number)
		{
			return { text: lines[line] ?? '' };
		},
	};
}

function parse(content: string): EprParser
{
	return new EprParser(createDocument(content));
}

function joinLines(...items: string[]): string
{
	return items.join('\n');
}

suite('EprParser Tests', () =>
{
	test('parses directives, struct and message', () =>
	{
		const parser = parse(joinLines(
			'protoname=TestProto;',
			'protoid=101;',
			'interfacestyle=stdcsgame;',
			'',
			'struct MyStruct',
			'{',
			'    int field1:1;',
			'    int field2:2 = 123; // 默认值',
			'    char array:3[];     // 变长数组',
			'    short array2:4[12]; // 定长数组',
			'};',
			'',
			'message SomeMessage:2 s2c',
			'{',
			'    MyStruct fieldX:1;',
			'};'
		));

		assert.deepStrictEqual(parser.directives.map(d => d.name), ['protoname', 'protoid', 'interfacestyle']);
		assert.strictEqual(parser.directives[0].value, 'TestProto');
		assert.strictEqual(parser.declarations.length, 2);

		const struct = parser.declarations[0];
		assert.strictEqual(struct.kind, EprDeclKind.Struct);
		assert.strictEqual(struct.name, 'MyStruct');
		assert.strictEqual(struct.tag, null);
		assert.deepStrictEqual(struct.fields.map(f => f.tag), [1, 2, 3, 4]);
		assert.strictEqual(struct.endLine, 10);

		const message = parser.declarations[1];
		assert.strictEqual(message.kind, EprDeclKind.Message);
		assert.strictEqual(message.name, 'SomeMessage');
		assert.strictEqual(message.tag, 2);
		assert.ok(message.modifiers.includes('s2c'));
		assert.deepStrictEqual(message.fields.map(f => f.name), ['fieldX']);

		assert.strictEqual(parser.getNextFieldTag(struct), 5);
		assert.strictEqual(parser.getNextStructureTag(), 3);
		assert.deepStrictEqual(parser.issues, []);
	});

	test('ignores tags, braces and semicolons inside comments and strings', () =>
	{
		const parser = parse(joinLines(
			'struct S',
			'{',
			'    // int fake:99;',
			'    string s:1 = "int fake:42; } {";',
			'    int a:2; /* int fake:77; */',
			'};'
		));

		const struct = parser.declarations[0];
		assert.deepStrictEqual(struct.fields.map(f => f.name), ['s', 'a']);
		assert.deepStrictEqual(struct.fields.map(f => f.tag), [1, 2]);
		assert.strictEqual(parser.getNextStructureTag(), 1);
	});

	test('parses bodies written on the declaration line', () =>
	{
		const parser = parse('struct A { int a:1; int b:2; };');

		const struct = parser.declarations[0];
		assert.strictEqual(struct.name, 'A');
		assert.deepStrictEqual(struct.fields.map(f => f.tag), [1, 2]);
	});

	test('supports multi-line declaration headers', () =>
	{
		const parser = parse(joinLines(
			'message PlayerInfo:30 s2c',
			'    ts = "parent:BaseInfo,prefix:m_"',
			'{',
			'    int nId:1;',
			'};'
		));

		const decl = parser.declarations[0];
		assert.strictEqual(decl.name, 'PlayerInfo');
		assert.strictEqual(decl.tag, 30);
		assert.ok(decl.modifiers.includes('s2c'));
		assert.ok(decl.modifiers.includes('ts'));
		assert.deepStrictEqual(decl.fields.map(f => f.name), ['nId']);
	});

	test('parses enum headers, items and underlying type', () =>
	{
		const parser = parse(joinLines(
			'enum class XiaZhuFail : ushort',
			'{',
			'    eUnknown = 0;',
			'    eInvalidArg = 1,',
			'    eOther = 100;',
			'};'
		));

		const decl = parser.declarations[0];
		assert.strictEqual(decl.kind, EprDeclKind.Enum);
		assert.strictEqual(decl.name, 'XiaZhuFail');
		assert.strictEqual(decl.baseType, 'ushort');
		assert.ok(decl.modifiers.includes('class'));
		assert.deepStrictEqual(decl.enumItems.map(i => i.name), ['eUnknown', 'eInvalidArg', 'eOther']);
		assert.deepStrictEqual(decl.enumItems.map(i => i.value), [0, 1, 100]);
	});

	test('parses enum items on one line', () =>
	{
		const parser = parse('enum E { A = 1, B, C = 5 };');
		const decl = parser.declarations[0];
		assert.deepStrictEqual(decl.enumItems.map(i => i.name), ['A', 'B', 'C']);
		assert.deepStrictEqual(decl.enumItems.map(i => i.value), [1, null, 5]);
	});

	test('parses userclass without a body', () =>
	{
		const parser = parse(joinLines(
			'struct Base',
			'{',
			'    int a:1;',
			'};',
			'userclass MyPlayer extends Base',
			'    cppinclude = "game/MyPlayer.h"',
			'    ;'
		));

		assert.strictEqual(parser.declarations.length, 2);
		const decl = parser.declarations[1];
		assert.strictEqual(decl.kind, EprDeclKind.UserClass);
		assert.strictEqual(decl.name, 'MyPlayer');
		assert.strictEqual(decl.baseType, 'Base');
		assert.strictEqual(decl.bodyDepth, -1);
	});

	test('recovers when the previous declaration is missing a closing brace', () =>
	{
		const parser = parse(joinLines(
			'struct A',
			'{',
			'    int a:1;',
			'message B:5',
			'{',
			'    int b:2;',
			'};'
		));

		assert.strictEqual(parser.declarations.length, 2);
		const a = parser.declarations[0];
		const b = parser.declarations[1];
		assert.strictEqual(a.name, 'A');
		assert.strictEqual(a.endLine, 2);
		assert.strictEqual(b.name, 'B');
		assert.strictEqual(b.tag, 5);
		assert.deepStrictEqual(b.fields.map(f => f.tag), [2]);
		assert.ok(parser.issues.some(issue => issue.message.includes("缺少 '}'")));
	});

	test('tolerates fields without semicolons', () =>
	{
		const parser = parse(joinLines(
			'struct S',
			'{',
			'    int a:1',
			'    int b:2',
			'};'
		));

		assert.deepStrictEqual(parser.declarations[0].fields.map(f => f.tag), [1, 2]);
	});

	test('ignores declarations inside block comments', () =>
	{
		const parser = parse(joinLines(
			'/*',
			'struct Fake',
			'{',
			'    int fake:1;',
			'};',
			'*/',
			'struct Real',
			'{',
			'    int a:1;',
			'};'
		));

		assert.deepStrictEqual(parser.declarations.map(d => d.name), ['Real']);
	});

	test('tracks line state for completion', () =>
	{
		const parser = parse(joinLines(
			'struct S',
			'{',
			'    int a:1;',
			'};'
		));

		const header = parser.getLineInfo(0);
		assert.strictEqual(header.mode, EprLineMode.Top);
		assert.strictEqual(header.depth, 0);
		assert.strictEqual(header.decl, null);

		const body = parser.getLineInfo(2);
		assert.strictEqual(body.mode, EprLineMode.Body);
		assert.strictEqual(body.depth, 1);
		assert.strictEqual(body.decl?.name, 'S');

		const closing = parser.getLineInfo(3);
		assert.strictEqual(closing.mode, EprLineMode.Body);
		assert.strictEqual(closing.depth, 1);
		assert.strictEqual(closing.endDepth, 0);
	});

	test('reports useful issues without stopping the parse', () =>
	{
		const parser = parse(joinLines(
			'struct S',
			'{',
			'    string s:1 = "abc',
			'    int a:1 = +1;',
			'};',
			'/* 未闭合'
		));

		assert.ok(parser.issues.some(issue => issue.message.includes('字符串未闭合')));
		assert.ok(parser.issues.some(issue => issue.message.includes('非法字符')));
		assert.ok(parser.issues.some(issue => issue.message.includes('块注释未闭合')));
	});

	test('keeps a declaration header at EOF', () =>
	{
		const parser = parse('struct Tail:12');
		assert.strictEqual(parser.declarations.length, 1);
		assert.strictEqual(parser.declarations[0].name, 'Tail');
		assert.strictEqual(parser.declarations[0].tag, 12);
	});

	test('computes next structure tag across struct and message', () =>
	{
		const parser = parse(joinLines(
			'struct A:7',
			'{',
			'    int a:1;',
			'};',
			'message B:3',
			'{',
			'    int b:1;',
			'};'
		));

		assert.strictEqual(parser.getNextStructureTag(), 8);
	});

	test('lowercases directive names for deduplication', () =>
	{
		const parser = parse(joinLines(
			'ProtoName=Foo;',
			'NotWriteDate=1;'
		));

		assert.ok(parser.getDirectiveNames().has('protoname'));
		assert.ok(parser.getDirectiveNames().has('notwritedate'));
	});

	test('parses field headers with card and array suffixes', () =>
	{
		const lexer = new EprLineLexer();
		const header = parseFieldHeader(lexer.scanLine('card MyType value:12[3] = {1,2};'));
		assert.ok(header);
		assert.strictEqual(header.typeName, 'MyType');
		assert.strictEqual(header.name, 'value');
		assert.strictEqual(header.tag, 12);
		assert.strictEqual(header.nameEnd, 17);
	});

	test('returns a tagless field header while the tag is being typed', () =>
	{
		const lexer = new EprLineLexer();
		const header = parseFieldHeader(lexer.scanLine('    int count'));
		assert.ok(header);
		assert.strictEqual(header.typeName, 'int');
		assert.strictEqual(header.name, 'count');
		assert.strictEqual(header.tag, null);
	});
});
