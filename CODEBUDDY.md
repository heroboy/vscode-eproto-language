# CODEBUDDY.md

本文件为 CodeBuddy 在本仓库工作时提供指引。

> 项目根目录的 `CODEBUDDY.md` 会被 CodeBuddy **自动读取并放入每次会话的上下文**，无需手动 `@` 引用；修改后需**新建会话**才会生效。请勿再创建 `CLAUDE.md` 以免两份内容不一致。

## 项目概述

`uitool-eproto-language` 是一个 VS Code 扩展，为 UITool 的 **epr 协议文件**（`.epr`）提供语言支持：语法高亮、智能感知（类型/关键字补全）、协议 id 自动补全、简单格式化、文件头初始化，以及调用外部编译器编译当前文件。

## 常用命令

```bash
pnpm install            # 安装依赖
pnpm run compile        # tsc 编译到 out/
pnpm run watch          # 增量编译
pnpm test               # 编译 → 语法分词测试 → 启动 VS Code 集成测试（mocha）
pnpm run test:grammar   # 只跑 TextMate 语法分词测试（纯 Node，不启动 VS Code）
pnpm run clean:vscode-test  # 清理 .vscode-test 缓存
```

调试：在 VS Code 中按 F5（`launch.json` 由扩展模板提供），扩展入口为 `out/extension.js`。

## 目录结构

- `src/extension.ts` — 扩展入口，注册命令、格式化器，调用 `activateEprParserStaff`。
- `src/EprLexer.ts` — 逐行词法扫描器 `EprLineLexer`：把一行切成 Identifier / Number / String / Comment / Punctuation / Unknown，跨行只维护块注释状态；单趟扫描、不回溯，供格式化器与解析器复用。
- `src/EprParser.ts` — 容错的结构解析器 `EprParser`：基于 `EprLexer` 解析协议指令、import、`struct`/`message`/`enum`/`userclass` 头部与字段/枚举项，支持跨行头、同一行写 `{`、漏写 `}`、漏写 `;`；输出 `declarations` / `directives` / `imports` / `issues` / 每行 `EprLineInfo`。同时导出 `parseFieldHeader` 供补全使用。
- `src/EprParserStaff.ts` — 提供给 VS Code 的能力：补全项提供者（关键字/内建与自定义类型/指令/结构修饰符/指令取值/tag）、输入 `;`/回车/`{` 后自动补 tag、`eproto.dumpCurrentLineState` 与 `eproto.dumpAllState` 调试命令。按 `document.version` 缓存解析结果。
- `src/Perf.ts` — 回调耗时监控：`measureCallback` / `warnIfSlow` 在耗时超过 20ms 时向 `EPR Perf` OutputChannel 写一条 `[WARN]`（含回调名、耗时、文件与行列）。目前用于补全、`onDidChangeTextDocument`（自动 tag）和格式化三个回调。
- `src/EprFormatter.ts` — `DocumentFormattingEditProvider` 实现，基于 `EprLineLexer` 只调整行首缩进与空白行：按花括号嵌套深度缩进、行首 `}` 回退一级、注释/字符串里的花括号不计数、块注释续行保持原样，对语法错误尽量容错。
- `src/InitEprDocument.ts` — `EPR: Init EPR Document`，在文件头补齐 `protoname/protoid/interfacestyle/...` 配置项，已存在的项不重复添加。
- `src/compile.ts` — `EPR: Compile Current EPR File`，保存文件后以 `vscode.Task` 调用 `compiler/eProtoCompilerExeV2.exe <epr 路径>`，输出到 `EPR Compile` OutputChannel。
- `src/CharUtil.ts` — 字符判断工具（旧 tokenizer 遗留使用）。
- `syntaxes/eproto.tmLanguage.json` — TextMate 语法定义，按 `EprDoc` 重写；repository 分为 comments / strings / numbers / directives / userclass / enum / struct / message / field（fieldPrimitive / fieldObject / fieldMsgtype）/ enumMember / declarationKeyword / declarationHead / terminators，作用域统一以 `.eproto` 结尾。注意 TextMate 的 `begin` 正则只能在单行内匹配（行是逐行分词的），所以 `struct` 与类型名分处两行这类写法无法用一条 begin 覆盖：`declarationKeyword` 兜底着色独占一行的关键字，`declarationHead` 从类型名那一行开始一段通用声明块（`meta.declaration.eproto` + `entity.name.type.eproto`），块内复用 `#field` 与 `#enumMember`。
- `language-configuration.json` — 注释、括号、自动闭合等编辑行为。
- `schema/` — `*.epr.json` 项目配置的 JSON Schema；`genSchema.ts` 用 zod 生成，未纳入 tsconfig。
- `samples/` — 参考用的语法/文本样例，非代码。
- `compiler/` — 随扩展打包的 Windows 编译器 exe。

## epr 语法要点

```
protoname=TestProto;
protoid=101;
interfacestyle=stdcsgame;

struct MyStruct
{
	int field1:1;
	int field2:2 = 123;   // 支持默认值
	char array:3[];       // 变长数组
	short array2:4[12];   // 定长数组
};

message SomeMessage:2 s2c   // :2 为消息 id，s2c/c2s/equal/var/msgfrom 为修饰标签
{
	MyStruct fieldX:1;      // 其它 message/struct 可作为字段类型
};
```

- 字段格式：`类型 名称:字段id[长度] = 默认值;`
- 内建类型见 `EprParserStaff.ts` 的 `BUILTIN_TYPES`；新增类型需同步该数组（必要时也同步 `syntaxes/eproto.tmLanguage.json`）。

## 开发约定与注意事项

- **缩进风格**：源码使用 Tab 缩进、Allman 大括号风格、文件名/接口保持现有命名（含历史拼写）。
- **编码**：epr 文件默认 GBK（`configurationDefaults` 中已设置 `files.encoding: gbk`），修改 epr 样例时勿改为 UTF-8。
- **解析器缓存**：`EprParserStaff.ts` 的 `g_Parsers` 以 `document.uri` 为键、按 `document.version` 缓存 `EprParser`；版本变化时整篇重解析（真实协议文件约 0.1–0.5ms，1700 行示例约 4ms），文档关闭时清理。修改解析逻辑时同时考虑补全、自动 tag 与两个 dump 命令的读取。
- **容错优先**：`EprParser` 不为语法错误抛异常，而是记录 `issues` 后继续；遇到未闭合结构会用「下一个 `struct/message/enum/userclass` 行」恢复，遇到行尾未写 `;` 的字段/枚举项也会收下。解析器只做结构与词法层面的识别，不做类型/取值校验（那是编译器的职责）。
- **补全触发**：补全与自动 tag 都读 `EprParser` 的行状态（`EprLineInfo`：行首深度、块注释、模式、所属定义、跨行头）。空格与 `:` 是补全触发字符，`message XX ` 后会立即列出修饰符；定义头判断优先于字段行，漏写 `}` 时也能继续补修饰符。自定义类型按当前单词前缀过滤；文件定义数超过 200 时，空前缀只列内建类型，避免一次性生成几千个补全项。自动补 tag 只在单字符变更（`;`、换行、`{`）时触发，且跳过撤销/重做；回车只在行尾生效，避免把一行拆成两半时误插。字段行回车会同时补 `:tag` 和漏写的 `;`；`message` 头回车/`{` 补消息号，**`struct` 不补 tag**。
- **格式化器**：只改行首缩进与空白行，不碰行内内容；`EprLineLexer.scanLine` 返回的 token 数组会被复用，需要保存时自行复制。块注释续行刻意保持原样（真实协议里常用于排版或被注释掉的代码）。
- **性能告警**：补全、`onDidChangeTextDocument`、格式化三个回调都经过 `measureCallback`；单次超过 20ms 会在 `EPR Perf` OutputChannel 追加 `[WARN] 回调名 耗时 | 文件位置`，用于定位卡顿。阈值与格式在 `src/Perf.ts`。
- **测试**：`test/suite/EprFormatter.test.ts`、`EprLexer.test.ts`、`EprParser.test.ts`、`EprParserStaff.test.ts`、`Perf.test.ts` 使用手写 mock `TextDocument` / 纯 token 断言；新增测试文件需以 `.test.ts` 命名，由 `test/suite/index.ts` 自动收集编译后的 `.test.js`。补全/插入位置相关的测试用 `|` 标记光标（见 `EprParserStaff.test.ts` 的 `createMarkedDocument`），喂给解析器前移除标记，不要写死行列号；测试文本优先用模板字符串。集成测试**只使用本地 VS Code**（`VSCODE_EXECUTABLE_PATH` 可覆盖），`test/runTest.ts` 不再自动下载运行时；本地 VS Code 正在更新时会直接报错，等更新完成再跑。
- **语法测试**：`test/grammar/TmLanguage.test.ts` 用 `vscode-textmate` + `vscode-oniguruma` 直接加载 `syntaxes/eproto.tmLanguage.json` 断言分词作用域，入口为 `test/grammar/run.ts`（编译后 `node ./out-test/test/grammar/run.js`）；新增用例按 `suite` / `test` 追加，覆盖示例协议里的常用写法。
- **已知小坑**：`schema/genSchema.ts` 输出到当前工作目录的 `./epr-project-schema.json`，而仓库中实际文件在 `schema/epr-project-schema.json`；且 `zod` 未列入 `devDependencies`、`schema/` 被 tsconfig 排除。
- 修改 `package.json` 中的 commands / menus / contributes 后需重新编译并重载窗口才能生效。
- **用编译器验证语法**：你可以调用 `compiler/` 目录下的编译器（`compiler/eProtoCompilerExeV2.exe <epr 路径>`）来测试 epr 文件是否合法，编译报错会输出错误行与原因。
- **临时文件**：调试脚本、临时输出、试验用 `.epr` 等一律写到仓库根目录的 `_tmp/` 下；用完不需要清理，也不要提交（应被 `.gitignore` 忽略）。禁止在 `src/`、`test/`、仓库根目录随意散落临时文件。

## 维护要求与权威文档

- **本文件必须始终保持是最新的**：任何对目录结构、命令、脚本、核心解析/补全/格式化逻辑、epr 语法支持的改动，都要同步更新本文件，避免留下过期描述。
- **epr 语言的详细权威文档在** `D:\GameServerDevelop\Utility\EprDoc`，涉及语法、类型系统、校验规则、代码生成、线上格式等细节时以其为准，不要凭记忆推断。主要文件：
  - `README.md` — 文档索引与总览
  - `01-词法与文件结构.md`
  - `02-协议指令.md`
  - `03-类型系统.md`
  - `04-结构体与消息.md`
  - `05-枚举.md`
  - `06-校验规则.md`
  - `07-代码生成.md`
  - `08-线上格式.md`
  - `09-实现对照与已知问题.md`
  - `tmp/` — 文档引用的示例 `.epr` / `.h` / `.cpp` 代码 （这里面都是临时文件，不需要参考）
- `D:\projects\NewStyleBigTableGame\BigGameProto\BigGameProto\Protocol` 目录下有大量（40+ 个）真实项目的 `.epr` 文件，可作为语法写法的参考示例；但不属于本仓库，**只读参考，不要修改**。
- 本仓库内的 `epr格式.md`、`README.md`、`test.epr` / `test2.epr` 只是简略示例；与 `EprDoc` 冲突时以 `EprDoc` 为准，并顺手修正本仓库示例。

## 提交约定

- **每次改完代码后必须自动 commit 一次**，无需再次询问或等待确认。
- 提交前先跑 `pnpm run compile` 确保 TypeScript 编译通过；改动涉及格式化逻辑时再跑 `pnpm test`。
- 一个改动批次对应一次提交，不要堆积多个不相关改动；提交信息用中文简述改动内容，例如 `修复字段 id 自动补全在多行数组下的错误`。
- 只提交与本次改动相关的文件，不要顺手提交 `out/`、`node_modules/`、`.vscode-test/` 等产物；若发现产物被跟踪，先确认 `.gitignore` 而非直接 `git add .`。
- 不修改 git 配置，不对 `main` 强制推送，不使用 `--amend` 覆盖已有提交（除非用户明确要求）。
