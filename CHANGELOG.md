# Change Log

All notable changes to the "uitool-eproto-language" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [1.0.2]
- 重写 epr 语法高亮：按 EprDoc 重新组织 TextMate 规则，作用域统一为 `*.eproto`；修复 `struct`/`message`/`enum` 关键字与类型名分处两行时不着色的问题
- 新增 `EprLexer` 逐行词法器，供格式化器与解析器复用
- 重写格式化器：按花括号嵌套调整缩进、行首 `}` 回退一级，注释与字符串内的花括号不再影响缩进
- 重写容错结构解析器 `EprParser`：支持跨行定义头、同一行写 `{`、漏写 `}`、漏写 `;`，只记录 `issues` 不抛异常
- 大幅改进补全：关键字 / 内建与自定义类型 / 协议指令 / 结构修饰符 / 指令取值 / 字段 tag；空格与 `:` 触发补全，文件定义过多时空前缀只列内建类型
- 新增自动补 tag：输入 `;`、回车或 `{` 时自动补字段 tag 与消息号（`struct` 不补），回车补全时顺带补漏写的 `;`
- 新增命令 `EPR: Dump Current Line State`、`EPR: Dump All State`，便于排查解析与补全状态
- 新增回调耗时监控：补全、自动 tag、格式化单次超过 20ms 会向 `EPR Parser` 输出通道写入警告
- 测试：新增 TextMate 分词测试与格式化 / 词法 / 解析 / 补全 / 性能单元测试，测试改用光标标记定位、只使用本地 VS Code
- 打包：新增 `.vscodeignore`，不再把源码、测试与临时文件打进扩展包

## [1.0.1]
- 更新epr编译器

## [0.0.3]
- 增加*.epr.json的schema。还未集成编译。
- 改进key=value的语法高亮。支持namespace=XXX或namespace XXXX的写法。
- 新增命令：EPR:Init Document，自动增加文件头。

## [0.0.2]
- 支持`int a[123]`，在`[]`中允许有数字了

## [Unreleased]

- Initial release