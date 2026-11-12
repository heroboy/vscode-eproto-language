# CLAUDE.md

本文件为 Claude Code / CodeBuddy 在本仓库工作时提供指引。

## 项目概述

`uitool-eproto-language` 是一个 VS Code 扩展，为 UITool 的 **epr 协议文件**（`.epr`）提供语言支持：语法高亮、智能感知（类型/关键字补全）、协议 id 自动补全、简单格式化、文件头初始化，以及调用外部编译器编译当前文件。

## 常用命令

```bash
pnpm install            # 安装依赖
pnpm run compile        # tsc 编译到 out/
pnpm run watch          # 增量编译
pnpm test               # 编译后启动 VS Code 集成测试（mocha）
pnpm run clean:vscode-test  # 清理 .vscode-test 缓存
```

调试：在 VS Code 中按 F5（`launch.json` 由扩展模板提供），扩展入口为 `out/extension.js`。

## 目录结构

- `src/extension.ts` — 扩展入口，注册命令、格式化器，调用 `activateEprStaff`。
- `src/EprParser2.ts` — 核心行状态机 `EprParser2` + `LineStatus`：逐行解析大括号深度、块注释状态，并提取 `message` / `struct` 定义（名称、protoId、类型）。支持增量更新（`onDidChangeTextDocument`）。
- `src/EprParerStaff.ts` — 提供给 VS Code 的能力：补全项提供者、输入 `;` 或换行后自动补协议 id、`eproto.dumpCurrentLineState` 调试命令。文件名中的 `Parer` 是历史拼写错误。
- `src/EprFormatter.ts` — `DocumentFormattingEditProvider` 实现，仅处理缩进（按 `{` / `}` 深度），对语法错误尽量容错。
- `src/InitEprDocument.ts` — `EPR: Init EPR Document`，在文件头补齐 `protoname/protoid/interfacestyle/...` 配置项，已存在的项不重复添加。
- `src/compile.ts` — `EPR: Compile Current EPR File`，保存文件后以 `vscode.Task` 调用 `compiler/eProtoCompilerExeV2.exe <epr 路径>`，输出到 `EPR Compile` OutputChannel。
- `src/CharUtil.ts` — 字符判断工具（旧 tokenizer 遗留使用）。
- `src/EprParser.ts.bak` — 旧解析器备份，**不参与编译**。
- `syntaxes/eproto.tmLanguage.json` — TextMate 语法定义（comments / settings / struct / message / types / numbers）。
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
- 内建类型见 `EprParerStaff.ts` 的 `TYPE_KEYWORDS`；新增类型需同步该数组（必要时也同步 `syntaxes/eproto.tmLanguage.json`）。

## 开发约定与注意事项

- **缩进风格**：源码使用 Tab 缩进、Allman 大括号风格、文件名/接口保持现有命名（含历史拼写）。
- **编码**：epr 文件默认 GBK（`configurationDefaults` 中已设置 `files.encoding: gbk`），修改 epr 样例时勿改为 UTF-8。
- **解析器缓存**：`g_Parsers` 以 `document.uri` 为键缓存 `EprParser2`，文档关闭时清理；修改解析逻辑时需同时保证增量路径（`onDidChangeTextDocument` / `rebuildFromLine`）与全量路径一致。
- **补全触发**：补全与自动加 id 依赖 `EprParser2` 的行状态，`isInBrace(line)` 判断的是**上一行**的行尾状态。
- **测试**：`test/suite/EprFormatter.test.ts` 使用手写 mock `TextDocument`，不依赖真实编辑器；新增测试文件需以 `.test.ts` 命名，由 `test/suite/index.ts` 自动收集编译后的 `.test.js`。
- **已知小坑**：`schema/genSchema.ts` 输出到当前工作目录的 `./epr-project-schema.json`，而仓库中实际文件在 `schema/epr-project-schema.json`；且 `zod` 未列入 `devDependencies`、`schema/` 被 tsconfig 排除。
- 修改 `package.json` 中的 commands / menus / contributes 后需重新编译并重载窗口才能生效。

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
  - `tmp/` — 文档引用的示例 `.epr` / `.h` / `.cpp` 代码
- `D:\projects\NewStyleBigTableGame\BigGameProto\BigGameProto\Protocol` 目录下有大量（40+ 个）真实项目的 `.epr` 文件，可作为语法写法的参考示例；但不属于本仓库，**只读参考，不要修改**。
- 本仓库内的 `epr格式.md`、`README.md`、`test.epr` / `test2.epr` 只是简略示例；与 `EprDoc` 冲突时以 `EprDoc` 为准，并顺手修正本仓库示例。

## 提交约定

- **每次改完代码后必须自动 commit 一次**，无需再次询问或等待确认。
- 提交前先跑 `pnpm run compile` 确保 TypeScript 编译通过；改动涉及格式化逻辑时再跑 `pnpm test`。
- 一个改动批次对应一次提交，不要堆积多个不相关改动；提交信息用中文简述改动内容，例如 `修复字段 id 自动补全在多行数组下的错误`。
- 只提交与本次改动相关的文件，不要顺手提交 `out/`、`node_modules/`、`.vscode-test/` 等产物；若发现产物被跟踪，先确认 `.gitignore` 而非直接 `git add .`。
- 不修改 git 配置，不对 `main` 强制推送，不使用 `--amend` 覆盖已有提交（除非用户明确要求）。
