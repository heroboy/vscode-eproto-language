以下是epr文件的示例：

protoname=TestProto;
protoid=101;
interfacestyle=stdcsgame;
serverlanguage=cpp;
csharpeventstyle=default;
notWriteDate=1;

struct MyStruct
{
	int field1:1;
	int field2:2 = 123; //支持默认值
	char array:3[];     //数组的写法
	short array2:4[12]; //定长数组
};

//后面的数字是消息的id
//后面可以接s2c,c2s等标签
message SomeMessage:2 s2c
{
	//内容同MyStruct

	MyStruct fieldX:1; //其它的message/struct可以作为类型
};