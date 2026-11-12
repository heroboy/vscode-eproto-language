import * as assert from 'assert';
import * as vscode from 'vscode';
import { EprParser } from '../../src/EprParser';
import {
	computeDeclarationTagInsertion,
	computeFieldInsertions,
	provideCompletionItems,
	TagInsertion,
} from '../../src/EprParserStaff';

/** 测试文本里的光标标记；喂给解析器/补全前会被删掉 */
const CURSOR = '|';

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

interface MarkedDocument
{
	readonly document: vscode.TextDocument;
	readonly parser: EprParser;
	readonly line: number;
	readonly character: number;
	readonly position: vscode.Position;
}

/** 把 | 当作光标：先算出 line/character，再从文本中移除 */
function createMarkedDocument(marked: string, languageId = 'eproto'): MarkedDocument
{
	const index = marked.indexOf(CURSOR);
	assert.ok(index >= 0, `测试文本必须包含光标标记 ${CURSOR}`);

	const content = marked.slice(0, index) + marked.slice(index + CURSOR.length);
	const before = marked.slice(0, index);
	const line = (before.match(/\n/g) ?? []).length;
	const character = index - (before.lastIndexOf('\n') + 1);
	const document = createDocument(content, languageId);

	return {
		document,
		parser: new EprParser(document),
		line,
		character,
		position: new vscode.Position(line, character),
	};
}

function labelsAt(marked: string, languageId = 'eproto'): string[] | undefined
{
	const { document, position } = createMarkedDocument(marked, languageId);
	const items = provideCompletionItems(document, position);
	return items?.map(item =>
		typeof item.label === 'string' ? item.label : item.label.label);
}

function contains(labels: string[] | undefined, name: string): boolean
{
	return !!labels && labels.includes(name);
}

/** 把插入应用到指定行，便于直接断言最终文本而不是坐标 */
function appliedLine(
	document: vscode.TextDocument,
	line: number,
	insertions: readonly TagInsertion[]
): string
{
	let text = document.lineAt(line).text;
	const onLine = insertions
		.filter(insertion => insertion.line === line)
		.sort((a, b) => b.character - a.character);

	for (const insertion of onLine)
	{
		text = text.slice(0, insertion.character) + insertion.text + text.slice(insertion.character);
	}
	return text;
}

function fieldInsertionsAt(marked: string, addSemicolon: boolean): TagInsertion[]
{
	const { document, parser, line } = createMarkedDocument(marked);
	return computeFieldInsertions(document, parser, line, addSemicolon);
}

function fieldLineAt(marked: string, addSemicolon: boolean): string
{
	const { document, parser, line } = createMarkedDocument(marked);
	const insertions = computeFieldInsertions(document, parser, line, addSemicolon);
	return appliedLine(document, line, insertions);
}

function declarationInsertionAt(marked: string): TagInsertion | null
{
	const { document, parser, line } = createMarkedDocument(marked);
	return computeDeclarationTagInsertion(document, parser, line);
}

function declaredLineAt(marked: string): string
{
	const { document, parser, line } = createMarkedDocument(marked);
	const insertion = computeDeclarationTagInsertion(document, parser, line);
	return appliedLine(document, line, insertion ? [insertion] : []);
}

suite('EprParserStaff Tests', () =>
{
	test('suggests decl keywords and missing directives at top level', () =>
	{
		const labels = labelsAt(`protoname=Foo;
|`);

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
		const labels = labelsAt('prot|');
		assert.ok(contains(labels, 'protoname'));
		assert.ok(contains(labels, 'protoid'));
	});

	test('suggests builtin and previously declared types inside a body', () =>
	{
		const labels = labelsAt(`struct MyType
{
    int a:1;
};

message M:2
{
    |
};

struct Later
{
    int x:1;
};`);

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
		const labels = labelsAt('message M |');
		assert.ok(contains(labels, 'c2s'));
		assert.ok(contains(labels, 's2c'));
		assert.ok(contains(labels, 'equal'));
		assert.ok(contains(labels, 'responses'));
		assert.ok(contains(labels, 'extends'));
		assert.ok(contains(labels, 'ts'));
	});

	test('does not repeat an already used modifier', () =>
	{
		const labels = labelsAt('message M s2c |');
		assert.ok(!contains(labels, 's2c'));
		assert.ok(contains(labels, 'c2s'));
	});

	test('suggests the next structure tag after a colon in a message header', () =>
	{
		assert.deepStrictEqual(labelsAt('message M:|'), ['1']);
	});

	test('does not suggest a tag for struct headers', () =>
	{
		assert.strictEqual(labelsAt('struct S:|'), undefined);
	});

	test('suggests the next field tag after a colon in a field', () =>
	{
		const labels = labelsAt(`struct S
{
    int a:1;
    int b:|
};`);

		assert.deepStrictEqual(labels, ['2']);
	});

	test('suggests directive values', () =>
	{
		assert.deepStrictEqual(
			labelsAt('interfacestyle = |'),
			['stdcsgame', 'stdcs', 'equal', 'nointerface']
		);
	});

	test('suggests boolean and enum default values', () =>
	{
		const boolLabels = labelsAt(`struct S
{
    bool flag:1 = |
};`);
		assert.ok(contains(boolLabels, 'true'));
		assert.ok(contains(boolLabels, 'false'));

		const enumLabels = labelsAt(`enum E
{
    A = 1;
    B = 2;
};
struct S
{
    E e:1 = |
};`);
		assert.ok(contains(enumLabels, 'A'));
		assert.ok(contains(enumLabels, 'B'));
	});

	test('returns nothing inside line and block comments', () =>
	{
		assert.strictEqual(labelsAt(`struct S
{
    int a:1; // comment|
};`), undefined);

		assert.strictEqual(labelsAt(`struct S
{
    /*
    abc|
};`), undefined);
	});

	test('returns nothing outside epr documents', () =>
	{
		assert.strictEqual(labelsAt('struct S|', 'plaintext'), undefined);
	});

	test('computes field tag and semicolon insertions', () =>
	{
		const marked = `struct S
{
    int a:1;
    int b|
};`;

		assert.strictEqual(fieldLineAt(marked, true), '    int b:2;');
		assert.strictEqual(fieldLineAt(marked, false), '    int b:2');

		assert.deepStrictEqual(fieldInsertionsAt(`struct S
{
    int a:1;|
};`, true), [], '已有 tag 和分号时不再插入');

		assert.deepStrictEqual(fieldInsertionsAt(`struct S|
{
    int a:1;
};`, true), [], '结构体外部不插入');

		assert.deepStrictEqual(fieldInsertionsAt(`struct S
{
    int a:1;
}|;`, true), [], '结束行不插入');
	});

	test('inserts the semicolon at the end of a field with a default value', () =>
	{
		assert.strictEqual(fieldLineAt(`struct S
{
    int a:1;
    int c = 3|
};`, true), '    int c:2 = 3;');

		//数组默认值还没闭合：只补 tag，不补分号
		assert.strictEqual(fieldLineAt(`struct S
{
    int a:1;
    int d = {|
        1, 2
    }
};`, true), '    int d:2 = {');

		assert.deepStrictEqual(fieldInsertionsAt(`struct S
{
    int a:1;
    int d = {
        1, 2|
    }
};`, true), [], '数组内部不处理');
	});

	test('computes a declaration tag insertion', () =>
	{
		assert.strictEqual(declaredLineAt(`message Foo|
{
    int a:1;
};`), 'message Foo:1');

		assert.strictEqual(declaredLineAt(`struct A:7
{
    int a:1;
};
message Bar {|`), 'message Bar:8 {');

		assert.strictEqual(declarationInsertionAt(`struct A:7
{
    int a:1;
};
message Bar:8 {|`), null, '已有 tag 不应重复插入');
	});

	test('does not add a tag to structs, enums, userclasses or body lines', () =>
	{
		assert.strictEqual(declarationInsertionAt('struct Plain|'), null);
		assert.strictEqual(declarationInsertionAt('enum E { A };|'), null);
		assert.strictEqual(declarationInsertionAt('userclass X extends Y;|'), null);
		assert.strictEqual(declarationInsertionAt(`struct S
{
    int a:1|
};`), null);
	});
});
