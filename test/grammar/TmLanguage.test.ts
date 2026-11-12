import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as oniguruma from 'vscode-oniguruma';
import * as vsctm from 'vscode-textmate';

const grammarPath = path.resolve(__dirname, '..', '..', '..', 'syntaxes', 'eproto.tmLanguage.json');

let grammar: vsctm.IGrammar;

function onigWasmPath(): string {
	const packageRoot = path.dirname(require.resolve('vscode-oniguruma/package.json'));
	return path.join(packageRoot, 'release', 'onig.wasm');
}

async function loadGrammar(): Promise<vsctm.IGrammar> {
	await oniguruma.loadWASM(fs.readFileSync(onigWasmPath()));

	const registry = new vsctm.Registry({
		onigLib: Promise.resolve({
			createOnigScanner: (sources: string[]) => new oniguruma.OnigScanner(sources),
			createOnigString: (content: string) => new oniguruma.OnigString(content)
		}),
		loadGrammar: async (scopeName: string) => {
			if (scopeName !== 'source.eproto') {
				return null;
			}
			return vsctm.parseRawGrammar(fs.readFileSync(grammarPath, 'utf8'), grammarPath);
		}
	});

	const loaded = await registry.loadGrammar('source.eproto');
	assert.ok(loaded, '无法加载 source.eproto 语法');
	return loaded;
}

function tokenizeLines(lines: string[]): vsctm.IToken[][] {
	let ruleStack: vsctm.StateStack = vsctm.INITIAL;
	const result: vsctm.IToken[][] = [];
	for (const line of lines) {
		const lineResult = grammar.tokenizeLine(line, ruleStack);
		result.push(lineResult.tokens);
		ruleStack = lineResult.ruleStack;
	}
	return result;
}

function scopesAt(tokens: vsctm.IToken[], index: number): string[] {
	const token = tokens.find((item) => index >= item.startIndex && index < item.endIndex);
	return token ? token.scopes : [];
}

function expectScope(tokens: vsctm.IToken[], line: string, needle: string, expectedScope: string): void {
	const index = line.indexOf(needle);
	assert.ok(index >= 0, `样例行中找不到 ${JSON.stringify(needle)}：${JSON.stringify(line)}`);
	const scopes = scopesAt(tokens, index);
	assert.ok(
		scopes.includes(expectedScope),
		`期望 ${JSON.stringify(needle)} 具有作用域 ${expectedScope}，实际为 [${scopes.join(', ')}]\n行：${JSON.stringify(line)}`
	);
}

function expectNoScope(tokens: vsctm.IToken[], line: string, needle: string, forbiddenScope: string): void {
	const index = line.indexOf(needle);
	assert.ok(index >= 0, `样例行中找不到 ${JSON.stringify(needle)}：${JSON.stringify(line)}`);
	const scopes = scopesAt(tokens, index);
	assert.ok(
		!scopes.includes(forbiddenScope),
		`${JSON.stringify(needle)} 不应具有作用域 ${forbiddenScope}，实际为 [${scopes.join(', ')}]`
	);
}

suite('eproto TextMate 语法', () => {
	suiteSetup(async () => {
		grammar = await loadGrammar();
	});

	suite('协议指令', () => {
		test('protoname 与 protoid', () => {
			const line = 'protoname=BigGame;';
			const [tokens] = tokenizeLines([line]);
			expectScope(tokens, line, 'protoname', 'entity.name.tag.directive.eproto');
			expectScope(tokens, line, 'BigGame', 'string.unquoted.directive.value.eproto');
			expectScope(tokens, line, ';', 'punctuation.terminator.eproto');

			const idLine = 'protoid=101;';
			const [idTokens] = tokenizeLines([idLine]);
			expectScope(idTokens, idLine, 'protoid', 'entity.name.tag.directive.eproto');
			expectScope(idTokens, idLine, '101', 'constant.numeric.directive.value.eproto');
		});

		test('namespace 支持带等号与不带等号两种写法', () => {
			const withoutEquals = 'namespace BigGame;';
			const [tokensA] = tokenizeLines([withoutEquals]);
			expectScope(tokensA, withoutEquals, 'namespace', 'entity.name.tag.directive.eproto');
			expectScope(tokensA, withoutEquals, 'BigGame', 'string.unquoted.directive.value.eproto');

			const withEquals = 'namespace = FistKingProto;';
			const [tokensB] = tokenizeLines([withEquals]);
			expectScope(tokensB, withEquals, 'FistKingProto', 'string.unquoted.directive.value.eproto');
		});

		test('指令名大小写不敏感', () => {
			const line = 'ProtoName=BigGame;';
			const [tokens] = tokenizeLines([line]);
			expectScope(tokens, line, 'ProtoName', 'entity.name.tag.directive.eproto');
			expectScope(tokens, line, 'BigGame', 'string.unquoted.directive.value.eproto');
		});

		test('生成开关类指令', () => {
			const cases: Array<[string, string, string]> = [
				['interfacestyle=stdcsgame;', 'stdcsgame', 'string.unquoted.directive.value.eproto'],
				['notWriteDate=1;', '1', 'constant.numeric.directive.value.eproto'],
				['interfaceWithTableID = 1;', '1', 'constant.numeric.directive.value.eproto'],
				['serverlanguage=cpp;', 'cpp', 'string.unquoted.directive.value.eproto'],
				['csharpeventstyle=default;', 'default', 'string.unquoted.directive.value.eproto'],
				['tsModuleStyle=moduleV3;', 'moduleV3', 'string.unquoted.directive.value.eproto']
			];
			for (const [line, value, scope] of cases) {
				const [tokens] = tokenizeLines([line]);
				expectScope(tokens, line, value, scope);
			}
		});
	});

	suite('注释', () => {
		test('行注释', () => {
			const line = '// 下注阶段';
			const [tokens] = tokenizeLines([line]);
			expectScope(tokens, line, '//', 'punctuation.definition.comment.eproto');
			expectScope(tokens, line, '下注阶段', 'comment.line.double-slash.eproto');
		});

		test('字段行尾注释', () => {
			const lines = ['struct S', '{', '    int x:1; // 行尾注释', '};'];
			const tokens = tokenizeLines(lines);
			expectScope(tokens[2], lines[2], '行尾注释', 'comment.line.double-slash.eproto');
			expectScope(tokens[2], lines[2], 'x', 'variable.other.field.eproto');
		});

		test('块注释可以跨行', () => {
			const lines = ['/* 第一行', '   第二行 */', 'protoname=P;'];
			const tokens = tokenizeLines(lines);
			expectScope(tokens[0], lines[0], '第一行', 'comment.block.eproto');
			expectScope(tokens[1], lines[1], '第二行', 'comment.block.eproto');
			expectScope(tokens[2], lines[2], 'protoname', 'entity.name.tag.directive.eproto');
		});
	});

	suite('枚举', () => {
		test('普通枚举与枚举项', () => {
			const lines = ['enum GamePhase', '{', '    gpXiaZhu;', '    gpKaiPai = 3;', '};'];
			const tokens = tokenizeLines(lines);
			expectScope(tokens[0], lines[0], 'enum', 'keyword.declaration.enum.eproto');
			expectScope(tokens[0], lines[0], 'GamePhase', 'entity.name.type.enum.eproto');
			expectScope(tokens[2], lines[2], 'gpXiaZhu', 'variable.other.enummember.eproto');
			expectScope(tokens[2], lines[2], ';', 'punctuation.separator.enum.eproto');
			expectScope(tokens[3], lines[3], 'gpKaiPai', 'variable.other.enummember.eproto');
			expectScope(tokens[3], lines[3], '3', 'constant.numeric.enum-value.eproto');
			expectScope(tokens[4], lines[4], '}', 'punctuation.section.block.end.enum.eproto');
		});

		test('enum class 与显式底层类型', () => {
			const classLine = 'enum class XiaZhuFailNewReason';
			const [classTokens] = tokenizeLines([classLine]);
			expectScope(classTokens, classLine, 'class', 'storage.modifier.class.eproto');
			expectScope(classTokens, classLine, 'XiaZhuFailNewReason', 'entity.name.type.enum.eproto');

			const baseLine = 'enum SmallCode : ushort';
			const [baseTokens] = tokenizeLines([baseLine]);
			expectScope(baseTokens, baseLine, 'SmallCode', 'entity.name.type.enum.eproto');
			expectScope(baseTokens, baseLine, 'ushort', 'storage.type.primitive.eproto');
		});

		test('同一行多个枚举项', () => {
			const lines = ['enum E { A = 1, B = 2; };'];
			const [tokens] = tokenizeLines(lines);
			expectScope(tokens, lines[0], 'A', 'variable.other.enummember.eproto');
			expectScope(tokens, lines[0], 'B', 'variable.other.enummember.eproto');
			expectScope(tokens, lines[0], '2', 'constant.numeric.enum-value.eproto');
		});
	});

	suite('结构体与消息', () => {
		test('struct 头部与字段', () => {
			const lines = ['struct Icon', '{', '    char icon:1;', '};'];
			const tokens = tokenizeLines(lines);
			expectScope(tokens[0], lines[0], 'struct', 'keyword.declaration.struct.eproto');
			expectScope(tokens[0], lines[0], 'Icon', 'entity.name.type.struct.eproto');
			expectScope(tokens[2], lines[2], 'char', 'storage.type.primitive.eproto');
			expectScope(tokens[2], lines[2], 'icon', 'variable.other.field.eproto');
			expectScope(tokens[2], lines[2], '1', 'constant.numeric.field-id.eproto');
			expectScope(tokens[2], lines[2], ';', 'punctuation.terminator.field.eproto');
			expectScope(tokens[3], lines[3], ';', 'punctuation.terminator.eproto');
		});

		test('message 的消息号与方向修饰符', () => {
			const line = 'message GameScene:1 s2c';
			const [tokens] = tokenizeLines([line]);
			expectScope(tokens, line, 'message', 'keyword.declaration.message.eproto');
			expectScope(tokens, line, 'GameScene', 'entity.name.type.message.eproto');
			expectScope(tokens, line, '1', 'constant.numeric.message-id.eproto');
			expectScope(tokens, line, 's2c', 'storage.modifier.eproto');
		});

		test('多个结构修饰符与继承', () => {
			const line = 'message FistKingScene:1 norecvfun var';
			const [tokens] = tokenizeLines([line]);
			expectScope(tokens, line, '1', 'constant.numeric.message-id.eproto');
			expectScope(tokens, line, 'norecvfun', 'storage.modifier.eproto');
			expectScope(tokens, line, 'var', 'storage.modifier.eproto');

			const extendsLine = 'struct OneNormalGame extends OneGame';
			const [extendsTokens] = tokenizeLines([extendsLine]);
			expectScope(extendsTokens, extendsLine, 'OneNormalGame', 'entity.name.type.struct.eproto');
			expectScope(extendsTokens, extendsLine, 'extends', 'storage.modifier.eproto');
		});

		test('结构体结束后退出结构作用域', () => {
			const lines = ['struct A', '{', '    int x:1;', '};', 'int y:2;'];
			const tokens = tokenizeLines(lines);
			expectScope(tokens[2], lines[2], 'x', 'meta.struct.eproto');
			expectScope(tokens[4], lines[4], 'int', 'source.eproto');
			expectNoScope(tokens[4], lines[4], 'int', 'meta.struct.eproto');
			expectNoScope(tokens[4], lines[4], 'y', 'variable.other.field.eproto');
		});
	});

	suite('字段', () => {
		function fieldTokens(fieldLine: string): vsctm.IToken[] {
			const lines = ['struct S', '{', `    ${fieldLine}`, '};'];
			return tokenizeLines(lines)[2];
		}

		test('64 位整型字段', () => {
			const line = '    int64 score:2;';
			const tokens = fieldTokens('int64 score:2;');
			expectScope(tokens, line, 'int64', 'storage.type.primitive.eproto');
			expectScope(tokens, line, 'score', 'variable.other.field.eproto');
			expectScope(tokens, line, '2', 'constant.numeric.field-id.eproto');
		});

		test('定长数组与自定义类型', () => {
			const line = '    Icon map:1[15];';
			const tokens = fieldTokens('Icon map:1[15];');
			expectScope(tokens, line, 'Icon', 'storage.type.object.eproto');
			expectScope(tokens, line, 'map', 'variable.other.field.eproto');
			expectScope(tokens, line, '[', 'punctuation.definition.array.eproto');
			expectScope(tokens, line, '15', 'constant.numeric.array-length.eproto');
		});

		test('变长数组', () => {
			const line = '    int64 totalAreaDownCoin:4[];';
			const tokens = fieldTokens('int64 totalAreaDownCoin:4[];');
			expectScope(tokens, line, 'totalAreaDownCoin', 'variable.other.field.eproto');
			expectScope(tokens, line, '[', 'punctuation.definition.array.eproto');
			expectScope(tokens, line, ']', 'punctuation.definition.array.eproto');
		});

		test('布尔默认值', () => {
			const line = '    bool willDropFragment:11 = false;';
			const tokens = fieldTokens('bool willDropFragment:11 = false;');
			expectScope(tokens, line, 'bool', 'storage.type.primitive.eproto');
			expectScope(tokens, line, '11', 'constant.numeric.field-id.eproto');
			expectScope(tokens, line, 'false', 'constant.language.boolean.eproto');
		});

		test('数值默认值', () => {
			const line = '    int addMapFragment:16 = 0;';
			const tokens = fieldTokens('int addMapFragment:16 = 0;');
			expectScope(tokens, line, 'addMapFragment', 'variable.other.field.eproto');
			expectScope(tokens, line, '0', 'constant.numeric.eproto');
		});

		test('字符串默认值', () => {
			const line = '    string param3:4 = "abc";';
			const tokens = fieldTokens('string param3:4 = "abc";');
			expectScope(tokens, line, 'string', 'storage.type.primitive.eproto');
			expectScope(tokens, line, '"abc"', 'string.quoted.double.eproto');
		});

		test('msgtype 字段', () => {
			const line = '    msgtype customScene:1;';
			const tokens = fieldTokens('msgtype customScene:1;');
			expectScope(tokens, line, 'msgtype', 'storage.type.msgtype.eproto');
			expectScope(tokens, line, 'customScene', 'variable.other.field.eproto');
			expectScope(tokens, line, '1', 'constant.numeric.field-id.eproto');
		});
	});
});
