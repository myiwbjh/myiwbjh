import { cp, mkdir, rm } from 'node:fs/promises';
const files=['index.html','app.js','styles.css','src'];
await rm('dist',{recursive:true,force:true});await mkdir('dist',{recursive:true});
for(const file of files)await cp(file,`dist/${file}`,{recursive:true});
console.log('Built static application in dist/');
