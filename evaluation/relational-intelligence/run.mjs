import {readFile} from 'node:fs/promises'
import {build} from 'esbuild'
const [dataset,predictions,split='holdout']=process.argv.slice(2)
if(!dataset||!predictions||!['development','holdout'].includes(split))throw new Error('Usage: node evaluation/relational-intelligence/run.mjs cases.json predictions.json [development|holdout]')
const out=await build({entryPoints:['evaluation/relational-intelligence/harness.ts'],bundle:true,write:false,platform:'node',format:'esm'})
const {evaluate}=await import('data:text/javascript;base64,'+Buffer.from(out.outputFiles[0].text).toString('base64'))
console.log(JSON.stringify(evaluate(JSON.parse(await readFile(dataset,'utf8')),JSON.parse(await readFile(predictions,'utf8')),{split}),null,2))
