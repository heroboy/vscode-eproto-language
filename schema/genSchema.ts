import * as z from 'zod';
import * as fs from 'node:fs';


const erp_desc = 'epr文件路径，如果是相对地址，则相对于配置文件路径';

const EprProjectSchemaCpp = z.object({
	language: z.literal('cpp'),
	outputDir: z.string().optional().describe('可选，默认为epr文件所在目录'),
	outputDirCpp: z.string().optional().describe('可选，默认和outputDir相同'),
	writeJson: z.boolean().optional().describe('可选，默认为false，是否输出json文件'),
	writeTestCase: z.boolean().optional().describe('可选，默认为false，是否输出测试用例'),
});
const EprProjectSchemaTs = z.object({
	language: z.literal('ts'),
	outputDir: z.string().optional().describe('可选，默认为epr文件所在目录'),
	writeTestCase: z.boolean().optional().describe('可选，默认为false，是否输出测试用例'),
});

const EprSchema = z.object({
	$schema: z.string().optional(),
	files: z.array(z.string().describe(erp_desc)),
	targets: z.array(EprProjectSchemaCpp.or(EprProjectSchemaTs)).describe('构建目标'),
});



const text = EprSchema.toJSONSchema({
	unrepresentable: 'throw'
});
fs.writeFileSync('./epr-project-schema.json', JSON.stringify(text, null, 2));