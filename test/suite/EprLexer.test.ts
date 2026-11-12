import * as assert from 'assert';
import { EprLineLexer, EprTokenType } from '../../src/EprLexer';

interface TokenSnapshot
{
	type: EprTokenType;
	text: string;
	start: number;
	end: number;
}

/** scanLine 返回的数组会被复用，测试里统一转成快照再断言 */
function lex(text: string, lexer?: EprLineLexer): TokenSnapshot[]
{
	const l = lexer ?? new EprLineLexer();
	return l.scanLine(text).map(t => ({ type: t.type, text: t.text, start: t.start, end: t.end }));
}

suite('EprLexer Tests', () =>
{
	test('splits identifiers, numbers and punctuation', () =>
	{
		const tokens = lex('int a:1 = -2;');
		assert.deepStrictEqual(tokens, [
			{ type: EprTokenType.Identifier, text: 'int', start: 0, end: 3 },
			{ type: EprTokenType.Identifier, text: 'a', start: 4, end: 5 },
			{ type: EprTokenType.Punctuation, text: ':', start: 5, end: 6 },
			{ type: EprTokenType.Number, text: '1', start: 6, end: 7 },
			{ type: EprTokenType.Punctuation, text: '=', start: 8, end: 9 },
			{ type: EprTokenType.Number, text: '-2', start: 10, end: 12 },
			{ type: EprTokenType.Punctuation, text: ';', start: 12, end: 13 },
		]);
	});

	test('recognizes float literals', () =>
	{
		assert.deepStrictEqual(
			lex('1.5f').map(t => t.text),
			['1.5f']
		);
		assert.deepStrictEqual(
			lex('.5').map(t => t.text),
			['.5']
		);
		assert.deepStrictEqual(
			lex('-0.5').map(t => t.text),
			['-0.5']
		);
	});

	test('treats a string as a single token, ignoring braces and slashes inside it', () =>
	{
		const tokens = lex('string s:1 = "// { }";');
		const stringToken = tokens.find(t => t.type === EprTokenType.String);
		assert.ok(stringToken);
		assert.strictEqual(stringToken.text, '"// { }"');
		assert.strictEqual(tokens.filter(t => t.type === EprTokenType.Comment).length, 0);
		assert.strictEqual(tokens.filter(t => t.text === '{').length, 0);
	});

	test('allows an unterminated string without throwing', () =>
	{
		const tokens = lex('string s:1 = "abc');
		assert.deepStrictEqual(tokens[tokens.length - 1], {
			type: EprTokenType.String,
			text: '"abc',
			start: 13,
			end: 17,
		});
	});

	test('consumes the rest of the line after a line comment', () =>
	{
		const tokens = lex('int a:1; // { }');
		assert.deepStrictEqual(tokens[tokens.length - 1], {
			type: EprTokenType.Comment,
			text: '// { }',
			start: 9,
			end: 15,
		});
		assert.strictEqual(tokens.filter(t => t.text === '{').length, 0);
	});

	test('continues lexing after an inline block comment', () =>
	{
		const tokens = lex('int a:1; /* { } */ int b:2;');
		assert.deepStrictEqual(
			tokens.map(t => [t.type, t.text]),
			[
				[EprTokenType.Identifier, 'int'],
				[EprTokenType.Identifier, 'a'],
				[EprTokenType.Punctuation, ':'],
				[EprTokenType.Number, '1'],
				[EprTokenType.Punctuation, ';'],
				[EprTokenType.Comment, '/* { } */'],
				[EprTokenType.Identifier, 'int'],
				[EprTokenType.Identifier, 'b'],
				[EprTokenType.Punctuation, ':'],
				[EprTokenType.Number, '2'],
				[EprTokenType.Punctuation, ';'],
			]
		);
	});

	test('carries block comment state across lines', () =>
	{
		const lexer = new EprLineLexer();
		assert.strictEqual(lexer.inBlockComment, false);

		const first = lex('struct S /* start', lexer);
		assert.strictEqual(lexer.inBlockComment, true);
		assert.deepStrictEqual(first[first.length - 1], {
			type: EprTokenType.Comment,
			text: '/* start',
			start: 9,
			end: 17,
		});

		const second = lex(' } */ int a:1;', lexer);
		assert.strictEqual(lexer.inBlockComment, false);
		assert.deepStrictEqual(
			second.map(t => [t.type, t.text]),
			[
				[EprTokenType.Comment, ' } */'],
				[EprTokenType.Identifier, 'int'],
				[EprTokenType.Identifier, 'a'],
				[EprTokenType.Punctuation, ':'],
				[EprTokenType.Number, '1'],
				[EprTokenType.Punctuation, ';'],
			]
		);
	});

	test('keeps block comment state until the closing marker', () =>
	{
		const lexer = new EprLineLexer();
		lex('/* line 1', lexer);
		lex('   line 2', lexer);
		assert.strictEqual(lexer.inBlockComment, true);

		lex('   line 3 */', lexer);
		assert.strictEqual(lexer.inBlockComment, false);
	});

	test('reset clears cross-line state', () =>
	{
		const lexer = new EprLineLexer();
		lex('/* start', lexer);
		assert.strictEqual(lexer.inBlockComment, true);

		lexer.reset();
		assert.strictEqual(lexer.inBlockComment, false);
	});

	test('reports illegal characters as Unknown', () =>
	{
		const tokens = lex('int a:1 = +1;');
		assert.deepStrictEqual(tokens[5], {
			type: EprTokenType.Unknown,
			text: '+',
			start: 10,
			end: 11,
		});
	});
});
